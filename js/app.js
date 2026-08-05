// app.js — view state, rendering, search, forms.

let totes = [];
let items = [];
let locations = [];
let fuseItems = null;
let fuseTotes = null;
let currentToteId = null;
let activeView = "home"; // "home" | "tote"
let editingToteId = null;
let editingItemId = null;
let editingLocationId = null;
let pendingTotePhoto = null; // dataURL or null/undefined(unchanged)
let pendingItemPhoto = null;
let pendingLocationPhoto = null;
let pendingQuickItemPhoto = null;
let homeSubView = "totes"; // "totes" | "items"

const $ = (sel) => document.querySelector(sel);

// ---------- Boot ----------
window.addEventListener("DOMContentLoaded", init);

async function init() {
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  preventDoubleTapZoom();

  await refreshData();
  bindEvents();

  const deepLinkHandled = handleDeepLink();
  if (!deepLinkHandled) {
    renderHome();
  }
}

// iOS Safari can still fire its double-tap-to-zoom gesture even with
// zoom disabled in the viewport meta and touch-action: manipulation set —
// this briefly shifts the viewport and throws off fixed-position elements
// like the FAB. Blocking the second tap's default action stops it cold.
function preventDoubleTapZoom() {
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (e) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 350) {
        e.preventDefault();
      }
      lastTouchEnd = now;
    },
    { passive: false }
  );
}

// ---------- Deep linking (QR codes land here) ----------
// URL shape: #tote=<id>&add=1  →  open that tote, and if add=1, open "add item" too.
function handleDeepLink() {
  const raw = location.hash.replace(/^#/, "");
  if (!raw) return false;

  const params = new URLSearchParams(raw);
  const toteId = params.get("tote");
  if (!toteId) return false;

  const tote = totes.find((t) => t.id === toteId);
  // Clear the hash either way so refresh/back doesn't re-trigger this.
  history.replaceState(null, "", location.pathname + location.search);

  if (!tote) {
    renderHome();
    return true;
  }

  openTote(toteId);
  if (params.get("add") === "1") {
    openItemModal(null);
  }
  return true;
}

async function refreshData() {
  totes = await DB.getAllTotes();
  items = await DB.getAllItems();
  locations = await DB.getAllLocations();
  buildSearchIndexes();
}

// Resolves a tote's location to a display name. Falls back to the old
// free-text `location` string for totes created before locations existed.
function resolveLocationName(tote) {
  if (tote.locationId) {
    const loc = locations.find((l) => l.id === tote.locationId);
    if (loc) return loc.name;
  }
  return tote.location || "";
}

function buildSearchIndexes() {
  const toteById = Object.fromEntries(totes.map((t) => [t.id, t]));
  const itemsWithToteName = items.map((it) => ({
    ...it,
    toteLabel: toteById[it.toteId] ? toteById[it.toteId].label : "",
  }));

  fuseItems = new Fuse(itemsWithToteName, {
    includeScore: true,
    threshold: 0.38,
    ignoreLocation: true,
    keys: [
      { name: "name", weight: 0.45 },
      { name: "tags", weight: 0.3 },
      { name: "description", weight: 0.15 },
      { name: "toteLabel", weight: 0.1 },
    ],
  });

  const totesWithLocationName = totes.map((t) => ({
    ...t,
    locationName: resolveLocationName(t),
  }));

  fuseTotes = new Fuse(totesWithLocationName, {
    includeScore: true,
    threshold: 0.38,
    ignoreLocation: true,
    keys: [
      { name: "label", weight: 0.6 },
      { name: "locationName", weight: 0.25 },
      { name: "notes", weight: 0.15 },
    ],
  });
}

// ---------- Rendering: Home ----------
function renderHome() {
  renderTotesGrid();
  renderItemsListView();
  renderLocationsListView();
}

function setHomeSubView(view) {
  homeSubView = view;
  document.querySelectorAll(".home-subtabs .tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.homeview === view);
  });
  $("#totes-subview").hidden = view !== "totes";
  $("#items-subview").hidden = view !== "items";
  $("#locations-subview").hidden = view !== "locations";
}

function renderTotesGrid() {
  const grid = $("#tote-grid");
  const empty = $("#empty-state");
  grid.innerHTML = "";

  if (totes.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  totes.forEach((tote) => {
    const count = items.filter((it) => it.toteId === tote.id).length;
    const locationName = resolveLocationName(tote);
    const card = document.createElement("div");
    card.className = "tote-card";
    card.innerHTML = `
      ${tote.photo
        ? `<img class="tote-card-photo" src="${tote.photo}" alt="">`
        : `<div class="tote-card-photo"></div>`}
      <div class="tote-card-body">
        <div class="tote-card-label">${escapeHtml(tote.label)}</div>
        <div class="tote-card-meta">
          <span class="tote-card-count">${count} item${count === 1 ? "" : "s"}</span>
          ${locationName ? `<span>${escapeHtml(locationName)}</span>` : ""}
        </div>
      </div>
    `;
    card.addEventListener("click", () => openTote(tote.id));
    grid.appendChild(card);
  });
}

function renderLocationsListView() {
  const list = $("#locations-list");
  const empty = $("#locations-empty-state");
  list.innerHTML = "";

  if (locations.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  locations.forEach((loc) => {
    const toteCount = totes.filter((t) => t.locationId === loc.id).length;
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
      ${loc.photo
        ? `<img class="item-photo" src="${loc.photo}" alt="">`
        : `<div class="item-photo"></div>`}
      <div class="item-body">
        <div class="item-name">${escapeHtml(loc.name)}</div>
        <div class="item-desc">${toteCount} tote${toteCount === 1 ? "" : "s"}${loc.description ? " · " + escapeHtml(loc.description) : ""}</div>
      </div>
      <div class="item-actions">
        <button class="icon-btn edit-location" data-id="${loc.id}" aria-label="Edit location">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        <button class="icon-btn danger delete-location" data-id="${loc.id}" aria-label="Delete location">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll(".edit-location").forEach((btn) =>
    btn.addEventListener("click", (e) => openLocationEditModal(e.currentTarget.dataset.id))
  );
  list.querySelectorAll(".delete-location").forEach((btn) =>
    btn.addEventListener("click", (e) => handleDeleteLocation(e.currentTarget.dataset.id))
  );
}

function renderItemsListView() {
  const list = $("#all-items-list");
  const empty = $("#items-empty-state");
  list.innerHTML = "";

  if (items.length === 0) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const toteById = Object.fromEntries(totes.map((t) => [t.id, t]));
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));

  sorted.forEach((item) => {
    const tote = toteById[item.toteId];
    const toteLabel = tote ? tote.label : "Unknown tote";
    const locationName = tote ? resolveLocationName(tote) : "";
    const sub = locationName ? `${toteLabel} · ${locationName}` : toteLabel;

    const row = makeResultRow(item.name, sub, item.photo, () => {
      if (tote) openTote(tote.id);
    });
    list.appendChild(row);
  });
}

// ---------- Rendering: Tote detail ----------
function openTote(id) {
  currentToteId = id;
  showView("tote");
  renderToteDetail();
}

function renderToteDetail() {
  const tote = totes.find((t) => t.id === currentToteId);
  if (!tote) { showView("home"); return; }

  $("#tote-detail-label").textContent = tote.label;
  const locationName = resolveLocationName(tote);
  $("#tote-detail-location").textContent = locationName;
  $("#tote-detail-location").hidden = !locationName;
  $("#tote-detail-notes").textContent = tote.notes || "";
  $("#tote-detail-notes").hidden = !tote.notes;

  const photoWrap = $("#tote-photo-wrap");
  if (tote.photo) {
    photoWrap.hidden = false;
    $("#tote-photo").src = tote.photo;
  } else {
    photoWrap.hidden = true;
  }

  const toteItems = items.filter((it) => it.toteId === currentToteId);
  $("#item-count-label").textContent = `${toteItems.length} ITEM${toteItems.length === 1 ? "" : "S"}`;

  const list = $("#item-list");
  list.innerHTML = "";
  if (toteItems.length === 0) {
    list.innerHTML = `<div class="empty-items">No items logged yet. Add what's inside this tote.</div>`;
    return;
  }

  toteItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
      ${item.photo
        ? `<img class="item-photo" src="${item.photo}" alt="">`
        : `<div class="item-photo"></div>`}
      <div class="item-body">
        <div class="item-name">${escapeHtml(item.name)}</div>
        ${item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : ""}
        ${item.tags && item.tags.length
          ? `<div class="item-tags">${item.tags.map((t) => `<span class="item-tag">${escapeHtml(t)}</span>`).join("")}</div>`
          : ""}
      </div>
      <div class="item-actions">
        <button class="icon-btn edit-item" data-id="${item.id}" aria-label="Edit item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        <button class="icon-btn danger delete-item" data-id="${item.id}" aria-label="Delete item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
        </button>
      </div>
    `;
    list.appendChild(row);
  });

  list.querySelectorAll(".edit-item").forEach((btn) =>
    btn.addEventListener("click", (e) => openItemModal(e.currentTarget.dataset.id))
  );
  list.querySelectorAll(".delete-item").forEach((btn) =>
    btn.addEventListener("click", async (e) => {
      if (confirm("Delete this item?")) {
        await DB.deleteItem(e.currentTarget.dataset.id);
        await refreshData();
        renderToteDetail();
      }
    })
  );
}

function showView(view) {
  activeView = view;
  $("#home-view").hidden = view !== "home";
  $("#tote-view").hidden = view !== "tote";
  $("#search-results").hidden = true;
  $("#search-input").value = "";
  $("#search-clear").hidden = true;
}

// ---------- Search ----------
function runSearch(query) {
  const resultsEl = $("#search-results");
  const q = query.trim();

  if (!q) {
    resultsEl.hidden = true;
    $("#home-view").hidden = activeView !== "home";
    $("#tote-view").hidden = activeView !== "tote";
    return;
  }

  $("#home-view").hidden = true;
  $("#tote-view").hidden = true;
  resultsEl.hidden = false;

  const itemMatches = fuseItems.search(q).slice(0, 25);
  const toteMatches = fuseTotes.search(q).slice(0, 10);

  resultsEl.innerHTML = "";

  if (itemMatches.length === 0 && toteMatches.length === 0) {
    resultsEl.innerHTML = `<div class="no-results">No matches for "${escapeHtml(q)}". Try a different word or tag.</div>`;
    return;
  }

  if (toteMatches.length) {
    const label = document.createElement("div");
    label.className = "results-group-label";
    label.textContent = "Totes";
    resultsEl.appendChild(label);
    toteMatches.forEach(({ item: tote }) => {
      const count = items.filter((it) => it.toteId === tote.id).length;
      const locationName = resolveLocationName(tote);
      resultsEl.appendChild(
        makeResultRow(tote.label, `${count} item${count === 1 ? "" : "s"}${locationName ? " · " + locationName : ""}`, tote.photo, () => {
          openTote(tote.id);
        })
      );
    });
  }

  if (itemMatches.length) {
    const label = document.createElement("div");
    label.className = "results-group-label";
    label.textContent = "Items";
    resultsEl.appendChild(label);
    itemMatches.forEach(({ item }) => {
      resultsEl.appendChild(
        makeResultRow(item.name, `in ${item.toteLabel || "an unnamed tote"}`, item.photo, () => {
          openTote(item.toteId);
        })
      );
    });
  }
}

function makeResultRow(title, sub, photo, onClick) {
  const row = document.createElement("div");
  row.className = "result-row";
  row.innerHTML = `
    ${photo ? `<img class="result-thumb" src="${photo}" alt="">` : `<div class="result-thumb"></div>`}
    <div class="result-text">
      <div class="result-title">${escapeHtml(title)}</div>
      <div class="result-sub">${escapeHtml(sub)}</div>
    </div>
  `;
  row.addEventListener("click", onClick);
  return row;
}

// ---------- Tote / Location modal (tabbed) ----------
let activeModalTab = "tote";

function openAddModal(toteIdToEdit) {
  editingToteId = toteIdToEdit || null;
  pendingTotePhoto = undefined;
  const tote = editingToteId ? totes.find((t) => t.id === editingToteId) : null;

  $("#tote-label-input").value = tote ? tote.label : "";
  $("#tote-notes-input").value = tote ? tote.notes || "" : "";
  populateLocationDropdown(tote ? tote.locationId || "" : "");

  renderPhotoPicker($("#tote-photo-picker"), tote ? tote.photo : null, (dataUrl) => {
    pendingTotePhoto = dataUrl;
  });

  resetLocationForm();
  resetQuickItemForm();
  setModalTab("tote");
  openModal("tote-modal");
  setTimeout(() => $("#tote-label-input").focus(), 50);
}

function setModalTab(tab) {
  activeModalTab = tab;
  document.querySelectorAll("#tote-modal .tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });
  $("#tote-tab-panel").hidden = tab !== "tote";
  $("#item-tab-panel").hidden = tab !== "item";
  $("#location-tab-panel").hidden = tab !== "location";
  $("#tote-modal-title").textContent =
    tab === "tote" ? (editingToteId ? "Edit Tote" : "New Tote") :
    tab === "item" ? "New Item" :
    (editingLocationId ? "Edit Location" : "New Location");
}

function populateLocationDropdown(selectedId) {
  const select = $("#tote-location-select");
  select.innerHTML = `<option value="">No location set</option>`;
  locations.forEach((loc) => {
    const opt = document.createElement("option");
    opt.value = loc.id;
    opt.textContent = loc.name;
    select.appendChild(opt);
  });
  select.value = selectedId || "";
}

// Populates any <select> with all totes, alphabetically, for choosing/moving an item's tote.
function populateToteDropdown(select, selectedId) {
  select.innerHTML = "";
  const sorted = [...totes].sort((a, b) => a.label.localeCompare(b.label));
  if (sorted.length === 0) {
    select.innerHTML = `<option value="">No totes yet</option>`;
    return;
  }
  sorted.forEach((tote) => {
    const opt = document.createElement("option");
    opt.value = tote.id;
    opt.textContent = tote.label;
    select.appendChild(opt);
  });
  select.value = selectedId || sorted[0].id;
}

async function handleToteSubmit(e) {
  e.preventDefault();
  const label = $("#tote-label-input").value.trim();
  if (!label) return;

  const existing = editingToteId ? totes.find((t) => t.id === editingToteId) : null;
  const locationId = $("#tote-location-select").value || null;

  const tote = {
    id: editingToteId || DB.uid(),
    label,
    locationId,
    notes: $("#tote-notes-input").value.trim(),
    photo: pendingTotePhoto !== undefined ? pendingTotePhoto : (existing ? existing.photo : null),
    createdAt: existing ? existing.createdAt : Date.now(),
  };

  await DB.saveTote(tote);
  await refreshData();
  closeModal("tote-modal");

  if (currentToteId === tote.id) {
    renderToteDetail();
  } else {
    renderHome();
  }
}

// ---------- Location form (lives inside the same modal, "Location" tab) ----------
function resetLocationForm() {
  editingLocationId = null;
  pendingLocationPhoto = undefined;
  $("#location-name-input").value = "";
  $("#location-desc-input").value = "";
  renderPhotoPicker($("#location-photo-picker"), null, (dataUrl) => {
    pendingLocationPhoto = dataUrl;
  });
}

// Opens the modal straight to the Location tab, pre-filled, for editing an
// existing location (reached from the home page Locations list).
function openLocationEditModal(id) {
  const loc = locations.find((l) => l.id === id);
  if (!loc) return;

  editingLocationId = id;
  pendingLocationPhoto = undefined;
  $("#location-name-input").value = loc.name;
  $("#location-desc-input").value = loc.description || "";
  renderPhotoPicker($("#location-photo-picker"), loc.photo, (dataUrl) => {
    pendingLocationPhoto = dataUrl;
  });

  setModalTab("location");
  openModal("tote-modal");
  setTimeout(() => $("#location-name-input").focus(), 50);
}

async function handleLocationSubmit(e) {
  e.preventDefault();
  const name = $("#location-name-input").value.trim();
  if (!name) return;

  const existing = editingLocationId ? locations.find((l) => l.id === editingLocationId) : null;
  const wasEditingStandalone = !!editingLocationId;

  const savedLocation = {
    id: editingLocationId || DB.uid(),
    name,
    description: $("#location-desc-input").value.trim(),
    photo: pendingLocationPhoto !== undefined ? pendingLocationPhoto : (existing ? existing.photo : null),
    createdAt: existing ? existing.createdAt : Date.now(),
  };

  await DB.saveLocation(savedLocation);
  await refreshData();

  if (wasEditingStandalone) {
    // Edited from the home Locations list — just close and refresh it.
    closeModal("tote-modal");
    renderHome();
  } else {
    // Created mid-tote-setup — jump back to the Tote tab with it selected.
    populateLocationDropdown(savedLocation.id);
    resetLocationForm();
    setModalTab("tote");
  }
}

async function handleDeleteLocation(id) {
  const loc = locations.find((l) => l.id === id);
  if (!loc) return;
  const toteCount = totes.filter((t) => t.locationId === id).length;
  const msg = toteCount > 0
    ? `Delete "${loc.name}"? ${toteCount} tote${toteCount === 1 ? "" : "s"} using it will be marked as having no location.`
    : `Delete "${loc.name}"?`;
  if (!confirm(msg)) return;

  await DB.deleteLocation(id);
  await refreshData();
  renderHome();
}

async function handleDeleteTote() {
  if (!currentToteId) return;
  const tote = totes.find((t) => t.id === currentToteId);
  const count = items.filter((it) => it.toteId === currentToteId).length;
  const msg = count > 0
    ? `Delete "${tote.label}" and its ${count} logged item${count === 1 ? "" : "s"}?`
    : `Delete "${tote.label}"?`;
  if (!confirm(msg)) return;

  await DB.deleteTote(currentToteId);
  currentToteId = null;
  await refreshData();
  showView("home");
  renderHome();
}

// ---------- Quick item form (Item tab in the FAB modal) ----------
function resetQuickItemForm() {
  pendingQuickItemPhoto = undefined;
  $("#quick-item-name-input").value = "";
  $("#quick-item-desc-input").value = "";
  $("#quick-item-tags-input").value = "";
  populateToteDropdown($("#quick-item-tote-select"), currentToteId);
  renderPhotoPicker($("#quick-item-photo-picker"), null, (dataUrl) => {
    pendingQuickItemPhoto = dataUrl;
  });
}

async function handleQuickItemSubmit(e) {
  e.preventDefault();
  const name = $("#quick-item-name-input").value.trim();
  const toteId = $("#quick-item-tote-select").value;
  if (!name || !toteId) return;

  const tags = $("#quick-item-tags-input").value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const item = {
    id: DB.uid(),
    toteId,
    name,
    description: $("#quick-item-desc-input").value.trim(),
    tags,
    photo: pendingQuickItemPhoto || null,
    createdAt: Date.now(),
  };

  await DB.saveItem(item);
  await refreshData();
  closeModal("tote-modal");
  openTote(toteId);
}

// ---------- Item modal ----------
function openItemModal(id) {
  editingItemId = id || null;
  pendingItemPhoto = undefined;
  const item = id ? items.find((it) => it.id === id) : null;

  $("#item-modal-title").textContent = id ? "Edit Item" : "New Item";
  populateToteDropdown($("#item-tote-select"), item ? item.toteId : currentToteId);
  $("#item-name-input").value = item ? item.name : "";
  $("#item-desc-input").value = item ? item.description || "" : "";
  $("#item-tags-input").value = item && item.tags ? item.tags.join(", ") : "";

  renderPhotoPicker($("#item-photo-picker"), item ? item.photo : null, (dataUrl) => {
    pendingItemPhoto = dataUrl;
  });

  openModal("item-modal");
  setTimeout(() => $("#item-name-input").focus(), 50);
}

async function handleItemSubmit(e) {
  e.preventDefault();
  const name = $("#item-name-input").value.trim();
  const toteId = $("#item-tote-select").value;
  if (!name || !toteId) return;

  const existing = editingItemId ? items.find((it) => it.id === editingItemId) : null;
  const tags = $("#item-tags-input").value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const item = {
    id: editingItemId || DB.uid(),
    toteId,
    name,
    description: $("#item-desc-input").value.trim(),
    tags,
    photo: pendingItemPhoto !== undefined ? pendingItemPhoto : (existing ? existing.photo : null),
    createdAt: existing ? existing.createdAt : Date.now(),
  };

  await DB.saveItem(item);
  await refreshData();
  closeModal("item-modal");

  // If the item moved to a different tote than the one we were viewing,
  // follow it there so it's clear where it ended up.
  if (toteId !== currentToteId) {
    openTote(toteId);
  } else {
    renderToteDetail();
  }
}

// ---------- Photo picker (shared by tote + item forms) ----------
function renderPhotoPicker(container, currentPhoto, onChange) {
  container.innerHTML = "";
  let photo = currentPhoto || null;

  function draw() {
    container.innerHTML = "";
    if (photo) {
      const img = document.createElement("img");
      img.className = "photo-preview";
      img.src = photo;
      container.appendChild(img);

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "photo-remove";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => {
        photo = null;
        onChange(null);
        draw();
      });
      container.appendChild(removeBtn);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "photo-btn";
      btn.textContent = "Add photo";
      btn.addEventListener("click", () => input.click());
      container.appendChild(btn);
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.hidden = true;
    input.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const dataUrl = await compressImage(file);
      photo = dataUrl;
      onChange(dataUrl);
      draw();
    });
    container.appendChild(input);
  }

  draw();
}

function compressImage(file, maxDim = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else if (height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---------- QR code ----------
function openQrModal() {
  const tote = totes.find((t) => t.id === currentToteId);
  if (!tote) return;

  const url = `${location.origin}${location.pathname}#tote=${tote.id}&add=1`;

  $("#qr-code-canvas").innerHTML = "";
  new QRCode($("#qr-code-canvas"), {
    text: url,
    width: 220,
    height: 220,
    colorDark: "#1C1B19",
    colorLight: "#F0EDE4",
    correctLevel: QRCode.CorrectLevel.M,
  });
  $("#qr-tote-label").textContent = tote.label;

  openModal("qr-modal");
}

// ---------- Backup & restore ----------
function exportData() {
  const payload = {
    app: "tote-tracker",
    version: 2,
    exportedAt: new Date().toISOString(),
    totes,
    items,
    locations,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `tote-tracker-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function triggerImport(mode) {
  const input = $("#import-file-input");
  input.onchange = async (e) => {
    const file = e.target.files[0];
    input.value = ""; // allow re-selecting the same file later
    if (!file) return;

    let parsed;
    try {
      const text = await file.text();
      parsed = JSON.parse(text);
    } catch (err) {
      alert("That file doesn't look like a valid backup (couldn't be read as JSON).");
      return;
    }

    if (!parsed || !Array.isArray(parsed.totes) || !Array.isArray(parsed.items)) {
      alert("That file doesn't look like a Tote Tracker backup.");
      return;
    }
    const parsedLocations = Array.isArray(parsed.locations) ? parsed.locations : [];

    const label = mode === "replace" ? "Replace ALL current data" : "Merge into current data";
    const detail = mode === "replace"
      ? `This will permanently delete everything currently in the app and load ${parsed.totes.length} tote(s), ${parsedLocations.length} location(s), and ${parsed.items.length} item(s) from the backup. This can't be undone.`
      : `This will add ${parsed.totes.length} tote(s), ${parsedLocations.length} location(s), and ${parsed.items.length} item(s) from the backup to what's already here. If the backup came from this same app, matching records will be overwritten rather than duplicated.`;

    if (!confirm(`${label}?\n\n${detail}`)) return;

    if (mode === "replace") {
      await DB.clearAll();
    }

    for (const loc of parsedLocations) {
      await DB.saveLocation(loc);
    }
    for (const tote of parsed.totes) {
      await DB.saveTote(tote);
    }
    for (const item of parsed.items) {
      await DB.saveItem(item);
    }

    await refreshData();
    closeModal("backup-modal");
    currentToteId = null;
    showView("home");
    renderHome();
    alert("Backup restored.");
  };
  input.click();
}

// ---------- Modal helpers ----------
function openModal(id) { $(`#${id}`).hidden = false; }
function closeModal(id) { $(`#${id}`).hidden = true; }

// ---------- Utility ----------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// ---------- Event wiring ----------
function bindEvents() {
  const searchInput = $("#search-input");
  searchInput.addEventListener("input", (e) => {
    $("#search-clear").hidden = !e.target.value;
    runSearch(e.target.value);
  });
  $("#search-clear").addEventListener("click", () => {
    searchInput.value = "";
    $("#search-clear").hidden = true;
    runSearch("");
    searchInput.blur();
  });

  $("#fab-new-tote").addEventListener("click", () => openAddModal(null));
  $("#back-btn").addEventListener("click", () => {
    currentToteId = null;
    showView("home");
    renderHome();
  });

  $("#edit-tote-btn").addEventListener("click", () => openAddModal(currentToteId));
  $("#qr-tote-btn").addEventListener("click", openQrModal);
  $("#qr-print-btn").addEventListener("click", () => window.print());
  $("#delete-tote-btn").addEventListener("click", handleDeleteTote);
  $("#add-item-btn").addEventListener("click", () => openItemModal(null));

  $("#backup-btn").addEventListener("click", () => openModal("backup-modal"));
  $("#export-btn").addEventListener("click", exportData);
  $("#import-merge-btn").addEventListener("click", () => triggerImport("merge"));
  $("#import-replace-btn").addEventListener("click", () => triggerImport("replace"));

  document.querySelectorAll("#tote-modal .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setModalTab(btn.dataset.tab));
  });
  $("#new-location-shortcut").addEventListener("click", () => setModalTab("location"));

  document.querySelectorAll(".home-subtabs .tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setHomeSubView(btn.dataset.homeview));
  });

  $("#tote-form").addEventListener("submit", handleToteSubmit);
  $("#item-form").addEventListener("submit", handleItemSubmit);
  $("#location-form").addEventListener("submit", handleLocationSubmit);
  $("#quick-item-form").addEventListener("submit", handleQuickItemSubmit);

  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll(".modal-backdrop").forEach((backdrop) => {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) backdrop.hidden = true;
    });
  });
}
