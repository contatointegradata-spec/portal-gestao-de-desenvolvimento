<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { http } from "../../lib/api.js";
import { confirmDialog, promptDialog, toast } from "../../lib/feedback.js";
import { navigate, replaceQuery, route } from "../../lib/router.js";
import { isManager } from "../../stores/session.js";
import {
  apiState, closeCollection, ensureRequestLoaded, forgetRequest, hasDirtyDrafts, loadCollections, openCollection, reloadTree
} from "../../stores/apiWorkspace.js";
import EmptyState from "../ui/EmptyState.vue";
import Icon from "../ui/Icon.vue";
import ApiTree from "./ApiTree.vue";
import CollectionSettingsModal from "./CollectionSettingsModal.vue";
import CollectionsHome from "./CollectionsHome.vue";
import EnvironmentModal from "./EnvironmentModal.vue";
import FolderSettingsModal from "./FolderSettingsModal.vue";
import ImportModal from "./ImportModal.vue";
import RequestEditor from "./RequestEditor.vue";

const collectionId = computed(() => route.segments[1] || null);
const collectionModal = ref(null); // { mode: 'create' | 'edit', collection }
const folderModal = ref(null);
const environmentsOpen = ref(false);
const importOpen = ref(false);
const loadError = ref("");

async function syncCollection(id) {
  loadError.value = "";
  if (!id) {
    closeCollection();
    return;
  }
  try {
    await openCollection(id);
    selectFromQuery();
  } catch (err) {
    loadError.value = err.message;
  }
}

async function selectFromQuery() {
  const requestId = route.query.req;
  if (!requestId || !apiState.current) return;
  if (!apiState.current.requests.some((item) => item.id === requestId)) return;
  try {
    await ensureRequestLoaded(requestId);
    apiState.selectedRequestId = requestId;
  } catch (err) {
    toast.error(err.message);
  }
}

function selectRequest(requestId) {
  replaceQuery({ req: requestId });
  selectFromQuery();
}

async function createRequest(folderId = null) {
  try {
    const created = await http.post("/api/apis/requests", {
      collectionId: apiState.current.collection.id,
      folderId,
      name: "Nova requisicao",
      method: "GET",
      url: "",
      authType: "inherit"
    });
    await reloadTree();
    selectRequest(created.id);
  } catch (err) {
    toast.error(err.message);
  }
}

async function createFolder(parentId = null) {
  const name = await promptDialog({ title: parentId ? "Nova subpasta" : "Nova pasta", label: "Nome da pasta", placeholder: "Ex.: Autenticacao, Clientes, Faturas" });
  if (!name) return;
  try {
    await http.post("/api/apis/folders", { collectionId: apiState.current.collection.id, parentId, name });
    await reloadTree();
  } catch (err) {
    toast.error(err.message);
  }
}

async function onTreeAction({ action, type, item }) {
  try {
    if (type === "folder") {
      if (action === "new-request") return createRequest(item.id);
      if (action === "new-folder") return createFolder(item.id);
      if (action === "settings") return (folderModal.value = item);
      if (action === "rename") {
        const name = await promptDialog({ title: "Renomear pasta", label: "Nome", value: item.name });
        if (name) await http.patch(`/api/apis/folders/${item.id}`, { name });
      }
      if (action === "delete") {
        const ok = await confirmDialog({ title: `Excluir a pasta "${item.name}"?`, message: "Todas as subpastas e requisicoes dentro dela serao excluidas.", confirmText: "Excluir", danger: true });
        if (!ok) return;
        const result = await http.del(`/api/apis/folders/${item.id}`);
        toast(`${result.deletedFolders} pasta(s) e ${result.deletedRequests} requisicao(oes) excluidas.`);
      }
    } else {
      if (action === "duplicate") {
        const copy = await http.post(`/api/apis/requests/${item.id}/duplicate`);
        await reloadTree();
        return selectRequest(copy.id);
      }
      if (action === "rename") {
        const name = await promptDialog({ title: "Renomear requisicao", label: "Nome", value: item.name });
        if (!name) return;
        const saved = await http.patch(`/api/apis/requests/${item.id}`, { name });
        if (apiState.originals[item.id]) {
          apiState.originals[item.id] = saved;
          if (apiState.drafts[item.id]) apiState.drafts[item.id].name = saved.name;
        }
      }
      if (action === "delete") {
        const ok = await confirmDialog({ title: `Excluir "${item.name}"?`, message: "A requisicao e seu historico serao removidos.", confirmText: "Excluir", danger: true });
        if (!ok) return;
        await http.del(`/api/apis/requests/${item.id}`);
        forgetRequest(item.id);
        if (route.query.req === item.id) replaceQuery({ req: undefined });
      }
    }
    await reloadTree();
  } catch (err) {
    toast.error(err.message);
  }
}

async function onCollectionSaved(collection, mode) {
  collectionModal.value = null;
  await loadCollections();
  if (mode === "create") navigate(`apis/${collection.id}`);
  else await reloadTree();
}

async function onCollectionDeleted() {
  collectionModal.value = null;
  await loadCollections();
  navigate("apis");
}

async function onImported(result) {
  importOpen.value = false;
  await loadCollections();
  if (result.collections.length === 1 && !result.intoCurrent) navigate(`apis/${result.collections[0].id}`);
  else if (result.intoCurrent) await reloadTree();
}

function beforeUnload(event) {
  if (hasDirtyDrafts()) {
    event.preventDefault();
    event.returnValue = "";
  }
}

watch(collectionId, syncCollection);
watch(() => route.query.req, (value) => {
  if (value) selectFromQuery();
  else apiState.selectedRequestId = null;
});

onMounted(async () => {
  window.addEventListener("beforeunload", beforeUnload);
  if (!apiState.collectionsLoaded) await loadCollections().catch((err) => toast.error(err.message));
  await syncCollection(collectionId.value);
});
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
</script>

<template>
  <div class="h-full">
    <CollectionsHome
      v-if="!collectionId"
      @create="collectionModal = { mode: 'create', collection: null }"
      @import="importOpen = true"
    />

    <div v-else-if="loadError" class="p-8">
      <EmptyState icon="alert-triangle" title="Nao foi possivel abrir a colecao" :description="loadError">
        <button type="button" class="btn-secondary" @click="navigate('apis')"><Icon name="arrow-left" :size="16" />Voltar para colecoes</button>
      </EmptyState>
    </div>

    <div v-else class="flex h-full min-h-0">
      <ApiTree
        @select="selectRequest"
        @new-request="createRequest()"
        @new-folder="createFolder()"
        @action="onTreeAction"
        @open-settings="collectionModal = { mode: 'edit', collection: apiState.current.collection }"
        @open-environments="environmentsOpen = true"
        @import="importOpen = true"
      />
      <section class="min-w-0 flex-1 overflow-hidden bg-white">
        <RequestEditor v-if="apiState.selectedRequestId" :key="apiState.selectedRequestId" :request-id="apiState.selectedRequestId" @open-environments="environmentsOpen = true" @changed="reloadTree" />
        <div v-else-if="apiState.current" class="flex h-full items-center justify-center p-8">
          <EmptyState icon="send" title="Selecione uma requisicao" :description="apiState.current.requests.length ? 'Escolha uma requisicao na arvore ao lado para editar e enviar.' : 'Esta colecao ainda nao possui requisicoes.'">
            <template v-if="isManager">
              <button type="button" class="btn-primary" @click="createRequest()"><Icon name="plus" :size="16" />Nova requisicao</button>
              <button type="button" class="btn-secondary" @click="createFolder()"><Icon name="folder-plus" :size="16" />Nova pasta</button>
              <button type="button" class="btn-secondary" @click="importOpen = true"><Icon name="import" :size="16" />Importar cURL / Postman</button>
            </template>
          </EmptyState>
        </div>
        <div v-else class="flex h-full items-center justify-center text-sm text-slate-400"><Icon name="loader" class="mr-2 animate-spin" />Carregando colecao...</div>
      </section>
    </div>

    <CollectionSettingsModal
      v-if="collectionModal"
      :mode="collectionModal.mode"
      :collection="collectionModal.collection"
      @close="collectionModal = null"
      @saved="onCollectionSaved"
      @deleted="onCollectionDeleted"
    />
    <FolderSettingsModal v-if="folderModal" :folder="folderModal" @close="folderModal = null" @saved="folderModal = null; reloadTree()" />
    <EnvironmentModal v-if="environmentsOpen && apiState.current" @close="environmentsOpen = false" />
    <ImportModal v-if="importOpen" @close="importOpen = false" @imported="onImported" />
  </div>
</template>
