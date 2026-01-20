document.addEventListener("DOMContentLoaded", () => { //这一层表示等 HTML 全部加载完成后再执行里面的 JS 代码，确保 DOM 元素都可用。
  // =====================================
  // Helpers
  // =====================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function safeJsonParse(s, fallback) {
    try {
      return JSON.parse(s);
    } catch {
      return fallback;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function autosizeTextarea(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight, 30)}px`;
  }

  // =====================================
  // IndexedDB for large images
  // =====================================
  const DB_NAME = "project_images";
  const DB_VERSION = 1;
  const STORE = "images";

  function openImageDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveImageToDB(imgObj) {
    const db = await openImageDB();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(imgObj);
    return tx.complete;
  }

  async function loadImageFromDB(id) {
    const db = await openImageDB();
    return new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result);
    });
  }

  // =====================================
  // Project list page (projects.html)
  // =====================================
  function initProjectsListUI() {
    const container = document.getElementById("projects-container");
    const createBtn = document.getElementById("create-project-btn");
    const input = document.getElementById("create-project-input");
    const okBtn = document.getElementById("create-project-ok");
    const cancelBtn = document.getElementById("create-project-cancel");

    // This JS is shared; if missing, skip.
    if (!container || !createBtn || !input || !okBtn || !cancelBtn) return;

    const STORAGE_KEY = "projects";

    function loadProjects() {
      return safeJsonParse(localStorage.getItem(STORAGE_KEY) || "[]", []);
    }

    function saveProjects(list) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    }

    function makeProjectCard(name) {
      const card = document.createElement("div");
      card.className = "project-card";

      const btn = document.createElement("button");
      btn.className = "project-btn";
      btn.type = "button";
      btn.textContent = name;
      btn.addEventListener("click", () => {
        window.location.href = `/projects/${encodeURIComponent(name)}`;
      });

      card.appendChild(btn);
      return card;
    }

    function renderProjects() {
      container.querySelectorAll(".project-card").forEach((e) => e.remove());

      const anchor = createBtn.closest(".project-card") || createBtn.parentElement;
      const list = loadProjects();

      list.forEach((name) => {
        if (anchor && anchor.parentElement) {
          anchor.parentElement.insertBefore(makeProjectCard(name), anchor);
        } else {
          container.appendChild(makeProjectCard(name));
        }
      });
    }

    function enterCreate() {
      createBtn.style.display = "none";
      input.style.display = "inline-block";
      okBtn.style.display = "inline-block";
      cancelBtn.style.display = "inline-block";
      input.value = "";
      input.focus();
    }

    function exitCreate() {
      input.style.display = "none";
      okBtn.style.display = "none";
      cancelBtn.style.display = "none";
      createBtn.style.display = "flex";
    }

    createBtn.addEventListener("click", enterCreate);
    cancelBtn.addEventListener("click", exitCreate);

    okBtn.addEventListener("click", () => {
      const name = input.value.trim();
      if (!name) return;

      const projects = loadProjects();
      if (projects.includes(name)) {
        exitCreate();
        return;
      }

      saveProjects([...projects, name]);
      renderProjects();
      exitCreate();
    });

    // Let Space be Space; only prevent it from triggering global shortcuts.
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
    });

    exitCreate();
    renderProjects();
  }

  // =====================================
  // Single project page (my_project.html)
  // =====================================
  function initProjectPage() {
    // ===== Match current my_project.html =====
    // Required anchors for the project page
    const addBtn = document.getElementById("add-experiment-btn");
    const formCard = document.getElementById("experiment-form");

    // If this page is not the single project page, skip.
    if (!addBtn || !formCard) return;

    // Ensure experiment controls + experiments list are OUTSIDE the top .page-container
    // (page-container is the frosted title/summary block; experiments must render below it)
    const pageContainer = document.querySelector(".page-container");
    const controls = document.querySelector(".experiment-controls");

    // Ensure we have an experiments list container and place it right AFTER the controls
    let experimentsList = document.getElementById("experiments-list");
    if (!experimentsList) {
      experimentsList = document.createElement("div");
      experimentsList.id = "experiments-list";
    }

    // Always re-home experimentsList to the correct place
    if (controls && controls.parentNode) {
      controls.parentNode.insertBefore(experimentsList, controls.nextSibling);
    } else {
      // Fallback: keep it usable even if controls are missing
      document.body.appendChild(experimentsList);
    }

    // Project identity
    const titleText = document.getElementById("project-title-text");
    const projectName = (titleText?.textContent || "").trim() || "Untitled";
    const STORAGE_KEY = `project_data:${projectName}`;

    const defaultState = {
      meta: {
        title: projectName,
        owner: "please add owner",
        summary: "please add summary",
      },
      experiments: [],
    };

    function loadState() {
      return (
        safeJsonParse(localStorage.getItem(STORAGE_KEY) || "null", null) ||
        structuredClone(defaultState)
      );
    }

    function saveState(s) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    }

    let state = loadState();

    // ---------- Inline edit (title / owner / summary) ----------
    function initInlineEdit(opts) {
      const textEl = document.getElementById(opts.textId);
      const inputEl = document.getElementById(opts.inputId);
      const editBtn = document.getElementById(opts.editId);
      const okBtn = document.getElementById(opts.okId);
      const cancelBtn = document.getElementById(opts.cancelId);
      if (!textEl || !inputEl || !editBtn || !okBtn || !cancelBtn) return;

      const placeholder = opts.placeholder ?? "";

      function enterEdit() {
        textEl.style.display = "none";
        editBtn.style.display = "none";

        inputEl.style.display = opts.inputDisplay || "inline-block";
        okBtn.style.display = "inline-block";
        cancelBtn.style.display = "inline-block";

        inputEl.value = (textEl.textContent || "").trim();
        if (inputEl.tagName === "TEXTAREA") autosizeTextarea(inputEl);
        inputEl.focus();
      }

      function exitEdit() {
        inputEl.style.display = "none";
        okBtn.style.display = "none";
        cancelBtn.style.display = "none";

        textEl.style.display = opts.textDisplay || "inline-block";
        editBtn.style.display = "inline-block";
      }

      editBtn.addEventListener("click", enterEdit);

      okBtn.addEventListener("click", () => {
        const val = (inputEl.value || "").trim();
        textEl.textContent = val || placeholder;
        opts.onSave?.(val || placeholder);
        exitEdit();
      });

      cancelBtn.addEventListener("click", exitEdit);

      if (inputEl.tagName === "TEXTAREA") {
        inputEl.addEventListener("input", () => autosizeTextarea(inputEl));
      }

      // apply persisted initial state into UI
      if (opts.getInitial) {
        const initVal = opts.getInitial();
        if (typeof initVal === "string" && initVal.length) {
          textEl.textContent = initVal;
        }
      }

      exitEdit();
    }

    // hydrate UI from stored meta
    if (state.meta?.title) {
      const el = document.getElementById("project-title-text");
      if (el) el.textContent = state.meta.title;
    }
    if (state.meta?.owner) {
      const el = document.getElementById("project-owner-text");
      if (el) el.textContent = state.meta.owner;
    }
    if (state.meta?.summary) {
      const el = document.getElementById("project-summary-text");
      if (el) el.textContent = state.meta.summary;
    }

    initInlineEdit({
      textId: "project-title-text",
      inputId: "project-title-input",
      editId: "project-title-edit",
      okId: "project-title-ok",
      cancelId: "project-title-cancel",
      placeholder: "",
      inputDisplay: "inline-block",
      textDisplay: "inline-block",
      getInitial: () => state.meta.title,
      onSave: (v) => {
        state.meta.title = v;
        saveState(state);
      },
    });

    initInlineEdit({
      textId: "project-owner-text",
      inputId: "project-owner-input",
      editId: "project-owner-edit",
      okId: "project-owner-ok",
      cancelId: "project-owner-cancel",
      placeholder: "please add owner",
      inputDisplay: "inline-block",
      textDisplay: "inline-block",
      getInitial: () => state.meta.owner,
      onSave: (v) => {
        state.meta.owner = v || "please add owner";
        saveState(state);
      },
    });

    initInlineEdit({
      textId: "project-summary-text",
      inputId: "project-summary-input",
      editId: "project-summary-edit",
      okId: "project-summary-ok",
      cancelId: "project-summary-cancel",
      placeholder: "please add summary",
      inputDisplay: "block",
      textDisplay: "block",
      getInitial: () => state.meta.summary,
      onSave: (v) => {
        state.meta.summary = v || "please add summary";
        saveState(state);
      },
    });

    // ---------- Add Experiment form toggle ----------
    function showForm() {
      formCard.style.display = "block";
      addBtn.style.display = "none";
      const ta = formCard.querySelector("textarea");
      if (ta) autosizeTextarea(ta);
    }

    function hideForm() {
      formCard.style.display = "none";
      addBtn.style.display = "inline-block";
    }

    addBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showForm();
    });

    // ---------- Experiment creation ----------
    function getFormFields() {
      return {
        technique: (document.getElementById("exp-technique")?.value || "").trim(),
        strain: (document.getElementById("exp-strain")?.value || "").trim(),
        sex: (document.getElementById("exp-sex")?.value || "").trim(),
        age: (document.getElementById("exp-age")?.value || "").trim(),
        quantity: (document.getElementById("exp-quantity")?.value || "").trim(),
        comments: (document.getElementById("exp-comments")?.value || "").trim(),
      };
    }

    function clearFormFields() {
      [
        "exp-technique",
        "exp-strain",
        "exp-sex",
        "exp-age",
        "exp-quantity",
        "exp-comments",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
    }

    function readFileAsDataURL(file) {    // 把图永久存下来
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
      });
    }

    function addExperimentToState(fields) { // 把text 永久存下来
      const exp = {
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        ...fields,
        images: [], // { id, dataUrl, legend }
      };
      state.experiments.push(exp);
      saveState(state);
      return exp;
    }

    function renderAllExperiments() { // 
      experimentsList.innerHTML = "";
      state.experiments.forEach((exp) => {
        experimentsList.appendChild(renderExperimentCard(exp));
      });
    }

    function renderExperimentCard(exp) {
      const card = document.createElement("div");
      card.className = "experiment-card";
      card.dataset.expId = exp.id;

      // 修改
      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "experiment-edit-icon";
      editBtn.title = "Edit";
      editBtn.textContent = "✎";

      // Create delete button
      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "experiment-delete-icon";
      delBtn.title = "Delete experiment";
      delBtn.textContent = "🗑";
      delBtn.style.background = "transparent";
      delBtn.style.border = "none";
      delBtn.style.cursor = "pointer";
      delBtn.addEventListener("mouseenter", () => {
        delBtn.style.transform = "scale(1.2)";});
      delBtn.addEventListener("mouseleave", () => {
        delBtn.style.transform = "scale(1)";});

      // Delete this experiment card
      delBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        state.experiments = state.experiments.filter((x) => x.id !== exp.id);
        saveState(state);
        card.remove();
      });

      const lines = document.createElement("div");
      lines.className = "exp-lines";
      lines.innerHTML = `
        <div class="experiment-header-row">
          <div class="exp-line">
            <span class="exp-label">Technique:</span>
            <span class="exp-val" data-field="technique">${escapeHtml(exp.technique)}</span>
          </div>
        </div>
        
        <div class="exp-row-3">
          <div class="exp-col"><span class="exp-label">Strain:</span> <span class="exp-val" data-field="strain">${escapeHtml(exp.strain)}</span></div>
          <div class="exp-col"><span class="exp-label">Sex:</span> <span class="exp-val" data-field="sex">${escapeHtml(exp.sex)}</span></div>
          <div class="exp-col"><span class="exp-label">Age:</span> <span class="exp-val" data-field="age">${escapeHtml(exp.age)}</span></div>
          <div class="exp-col"><span class="exp-label">Quantity:</span> <span class="exp-val" data-field="quantity">${escapeHtml(exp.quantity)}</span></div>
        </div>

        <div class="exp-line">
          <span class="exp-label">Comments:</span>
        </div>
        <div class="exp-line">
          <span class="exp-val exp-comments-val" data-field="comments">${escapeHtml(exp.comments)}</span>
        </div>
      `;
      // Place editBtn and delBtn inside the experiment-header-row after setting lines.innerHTML
      const headerRow = lines.querySelector(".experiment-header-row");
      headerRow.appendChild(editBtn);
      headerRow.appendChild(delBtn);

      const inlineControls = document.createElement("div");
      inlineControls.className = "exp-inline-controls";
      inlineControls.style.display = "none";
      inlineControls.innerHTML = `
        <button type="button" class="exp-inline-ok">OK</button>
        <button type="button" class="exp-inline-cancel">Cancel</button>
      `;

      const uploadWrap = document.createElement("div");
      uploadWrap.className = "experiment-upload-card";

      // ---------- uploaded images ---------- 
      const grid = document.createElement("div");
      grid.className = "image-grid";

      const uploadCard = document.createElement("div");
      uploadCard.className = "image-upload-card";
      uploadCard.innerHTML = `
        <div class="upload-inner" style="width:100%; display:flex; flex-direction:column; align-items:center;">
          <input class="upload-input" type="file" accept="image/*" style="display:none;" />

          <label class="upload-choose" style="display:inline-flex; align-items:center; justify-content:center;">
            Choose File to Upload
          </label>

          <div class="upload-preview-slot"></div>
          <button type="button" class="upload-ok">OK</button>
        </div>
      `;

      grid.appendChild(uploadCard);
      uploadWrap.appendChild(grid);

      card.appendChild(lines);
      card.appendChild(inlineControls);
      card.appendChild(uploadWrap);

      // existing images
      exp.images.forEach((img) => {
        grid.insertBefore(renderImageTile(exp.id, img), uploadCard);
      });

      let editMode = false;
      let snapshot = null;

      function enterEditMode() {
        if (editMode) return;
        editMode = true;
        snapshot = {
          technique: exp.technique,
          strain: exp.strain,
          sex: exp.sex,
          age: exp.age,
          quantity: exp.quantity,
          comments: exp.comments,
        };

        $$(".exp-val", lines).forEach((valSpan) => {
          const field = valSpan.dataset.field;
          const current = valSpan.textContent;

          let editor;
          if (field === "comments") {
            editor = document.createElement("textarea");
            editor.className = "exp-editor exp-editor-textarea";
            editor.value = current;
            editor.rows = 2;
            editor.dataset.field = field;
            editor.addEventListener("input", () => autosizeTextarea(editor));
            setTimeout(() => autosizeTextarea(editor), 0);
          } else {
            editor = document.createElement("input");
            editor.className = "exp-editor";
            editor.type = "text";
            editor.value = current;
            editor.dataset.field = field;
          }

          valSpan.replaceWith(editor);
        });

        inlineControls.style.display = "flex";
      }

      editBtn.addEventListener("click", enterEditMode);

      inlineControls.querySelector(".exp-inline-ok").addEventListener("click", () => {
        const updated = {};
        $$(".exp-editor", card).forEach((ed) => {
          updated[ed.dataset.field] = (ed.value || "").trim();
        });

        exp.technique = updated.technique ?? exp.technique;
        exp.strain = updated.strain ?? exp.strain;
        exp.sex = updated.sex ?? exp.sex;
        exp.age = updated.age ?? exp.age;
        exp.quantity = updated.quantity ?? exp.quantity;
        exp.comments = updated.comments ?? exp.comments;

        const idx = state.experiments.findIndex((x) => x.id === exp.id);
        if (idx >= 0) state.experiments[idx] = exp;
        saveState(state);

        card.replaceWith(renderExperimentCard(exp));
      });

      inlineControls.querySelector(".exp-inline-cancel").addEventListener("click", () => {
        if (snapshot) {
          exp.technique = snapshot.technique;
          exp.strain = snapshot.strain;
          exp.sex = snapshot.sex;
          exp.age = snapshot.age;
          exp.quantity = snapshot.quantity;
          exp.comments = snapshot.comments;
        }
        card.replaceWith(renderExperimentCard(exp));
      });

      // upload
      const fileInput = uploadCard.querySelector(".upload-input");
      const okUpload = uploadCard.querySelector(".upload-ok");
      let pendingFile = null;
      const chooseLabel = uploadCard.querySelector(".upload-choose");
      const previewSlot = uploadCard.querySelector(".upload-preview-slot");

      // clicking the label opens the file picker
      chooseLabel.addEventListener("click", () => {
        fileInput.click();
      });

      fileInput.addEventListener("change", () => {
        pendingFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

        // when a file is selected, hide the choose control and show the preview slot
        chooseLabel.style.display = "none";
        previewSlot.style.display = "block";

        const oldPrev = uploadCard.querySelector(".upload-preview");
        if (oldPrev) oldPrev.remove();

        if (pendingFile && pendingFile.type && pendingFile.type.startsWith("image/")) {
          const prev = document.createElement("img");
          prev.className = "upload-preview";
          prev.src = URL.createObjectURL(pendingFile);
          prev.alt = "preview";
          previewSlot.innerHTML = "";
          previewSlot.appendChild(prev);
        }
        okUpload.style.display = pendingFile ? "inline-block" : "none";
      });

      okUpload.addEventListener("click", async () => {
        if (!pendingFile) return;
        if (!pendingFile.type || !pendingFile.type.startsWith("image/")) return;

        const imgObj = {
          id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
          blob: pendingFile,
          legend: "legend",
        };

        await saveImageToDB(imgObj);

        exp.images.push({ id: imgObj.id, legend: imgObj.legend });
        const idx = state.experiments.findIndex((x) => x.id === exp.id);
        if (idx >= 0) state.experiments[idx] = exp;
        saveState(state);

        grid.insertBefore(renderImageTile(exp.id, { id: imgObj.id, legend: imgObj.legend }), uploadCard);

        pendingFile = null;
        fileInput.value = "";
        const oldPrev = uploadCard.querySelector(".upload-preview");
        if (oldPrev) oldPrev.remove();
        okUpload.style.display = "none";
        previewSlot.innerHTML = "";
        previewSlot.style.display = "none";
        chooseLabel.style.display = "inline-flex";
      });

      return card;
    }

    // 上传图片显示单元
    function renderImageTile(expId, imgObj) {
      const tile = document.createElement("div");
      tile.className = "image-tile";
      tile.dataset.imgId = imgObj.id;

      const wrap = document.createElement("div");
      wrap.className = "image-wrap";
      wrap.style.position = "relative";

      const img = document.createElement("img");
      img.className = "uploaded-image";
      loadImageFromDB(imgObj.id).then((full) => {
        if (!full) return;
        img.src = URL.createObjectURL(full.blob);
      });
      img.alt = "uploaded";
      img.style.width = "300px";
      img.style.height = "300px";
      img.style.objectFit = "contain";
      img.style.display = "block";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "img-trash";
      del.title = "Delete";
      del.textContent = "🗑";

      wrap.appendChild(img);
      wrap.appendChild(del);

      // legend display
      const legendBox = document.createElement("div");
      legendBox.className = "legend-text";
      legendBox.textContent = imgObj.legend || "legend";

      // click to edit
      legendBox.addEventListener("click", () => {
        const editor = document.createElement("textarea");
        editor.className = "legend-input";
        editor.value = legendBox.textContent;
        editor.rows = 1;
        autosizeTextarea(editor);

        editor.addEventListener("input", () => autosizeTextarea(editor));

        editor.addEventListener("blur", () => {
          const val = editor.value.trim() || "legend";
          legendBox.textContent = val;

          const exp = state.experiments.find((x) => x.id === expId);
          if (exp) {
            const imgRef = exp.images.find((x) => x.id === imgObj.id);
            if (imgRef) {
              imgRef.legend = val;
              saveState(state);
            }
          }

          editor.replaceWith(legendBox);
        });

        legendBox.replaceWith(editor);
        editor.focus();
      });

      del.addEventListener("click", () => {
        const exp = state.experiments.find((x) => x.id === expId);
        if (!exp) return;
        exp.images = exp.images.filter((x) => x.id !== imgObj.id);
        saveState(state);
        tile.remove();
      });

      tile.appendChild(wrap);
      tile.appendChild(legendBox);
      return tile;
    }

    // Form OK/Cancel buttons 
    const formOk = document.getElementById("exp-ok");
    const formCancel = document.getElementById("exp-cancel");

    formOk?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const fields = getFormFields();
      if (!fields.technique) return;

      const exp = addExperimentToState(fields);
      experimentsList.appendChild(renderExperimentCard(exp));

      clearFormFields();
      hideForm();
    });

    formCancel?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideForm();
    });

    // Initial render
    hideForm();
    renderAllExperiments();
  }

  // =====================================
  // Boot
  // =====================================
  try {
    initProjectsListUI();
  } catch (e) {
    console.error("project.js initProjectsListUI failed", e);
  }

  try {
    initProjectPage();
  } catch (e) {
    console.error("project.js initProjectPage failed", e);
  }
});