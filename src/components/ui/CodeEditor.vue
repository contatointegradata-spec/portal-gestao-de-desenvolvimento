<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { basicSetup } from "codemirror";
import { Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { oneDark } from "@codemirror/theme-one-dark";

const props = defineProps({
  modelValue: { type: String, default: "" },
  language: { type: String, default: "text" },
  readonly: { type: Boolean, default: false },
  dark: { type: Boolean, default: true },
  placeholder: { type: String, default: "" },
  minHeight: { type: String, default: "240px" },
  maxHeight: { type: String, default: "" }
});
const emit = defineEmits(["update:modelValue", "save", "run"]);

const host = ref(null);
let view = null;
const languageSlot = new Compartment();
const readonlySlot = new Compartment();

function languageExtension(language) {
  if (language === "python") return python();
  if (language === "javascript") return javascript();
  if (language === "json") return json();
  return [];
}

const lightTheme = EditorView.theme({
  "&": { backgroundColor: "#ffffff" },
  ".cm-gutters": { backgroundColor: "#f8fafc", color: "#94a3b8", borderRight: "1px solid #e2e8f0" },
  ".cm-activeLineGutter": { backgroundColor: "#ecfbf3" },
  ".cm-activeLine": { backgroundColor: "#f8fafc" }
});

onMounted(() => {
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        keymap.of([
          indentWithTab,
          { key: "Mod-s", preventDefault: true, run: () => { emit("save"); return true; } },
          { key: "Mod-Enter", preventDefault: true, run: () => { emit("run"); return true; } }
        ]),
        languageSlot.of(languageExtension(props.language)),
        readonlySlot.of([EditorState.readOnly.of(props.readonly), EditorView.editable.of(!props.readonly)]),
        props.dark ? oneDark : lightTheme,
        props.placeholder ? placeholderExt(props.placeholder) : [],
        EditorView.lineWrapping,
        EditorView.theme({
          "&": { minHeight: props.minHeight, ...(props.maxHeight ? { maxHeight: props.maxHeight } : {}) },
          ".cm-scroller": { minHeight: props.minHeight, ...(props.maxHeight ? { maxHeight: props.maxHeight } : {}) }
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) emit("update:modelValue", update.state.doc.toString());
        })
      ]
    })
  });
});

watch(() => props.modelValue, (value) => {
  if (!view) return;
  const current = view.state.doc.toString();
  if (value !== current) view.dispatch({ changes: { from: 0, to: current.length, insert: value || "" } });
});

watch(() => props.language, (language) => {
  view?.dispatch({ effects: languageSlot.reconfigure(languageExtension(language)) });
});

watch(() => props.readonly, (readonly) => {
  view?.dispatch({ effects: readonlySlot.reconfigure([EditorState.readOnly.of(readonly), EditorView.editable.of(!readonly)]) });
});

/** Posiciona o cursor na linha informada (usado ao exibir erros de sintaxe). */
function goToLine(lineNumber) {
  if (!view || !lineNumber) return;
  const line = view.state.doc.line(Math.min(Math.max(1, lineNumber), view.state.doc.lines));
  view.dispatch({ selection: EditorSelection.range(line.from, line.to), scrollIntoView: true });
  view.focus();
}

defineExpose({ goToLine });

onBeforeUnmount(() => view?.destroy());
</script>

<template>
  <div ref="host" class="overflow-hidden rounded-xl border" :class="dark ? 'border-slate-800 bg-[#282c34]' : 'border-slate-200 bg-white'" />
</template>
