import { store } from './storage.js';
import { toCSV, parseCSV, validDate } from './csv.js';
import { analyzePhoto } from './openai.js';
const DAILY_GOAL = 2200;
const $ = id => document.getElementById(id);
const fields = ['grams', 'kcal100', 'protein100', 'carbs100', 'fat100'];
let currentFoods = [];
let meals = [];
let previewUrl;
let requestController;
let storageReadable = false;
let selectedDate = localDate();
let loadingVersion = 0;
let saving = false;
let draftId;
let apiKey = '';
let model = 'gpt-6-luna';

function message(text = '', isError = false) {
  $('message').textContent = text;
  $('message').hidden = !text;
  $('message').classList.toggle('error', isError);
}
function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function localTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
}
function fileTimestamp() {
  const now = new Date();
  return `${localDate()}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
}
async function loadMeals() {
  const version = ++loadingVersion;
  meals = [];
  renderDashboard();
  $('mealList').textContent = 'Mahlzeiten werden geladen …';
  try {
    const data = await store.list(selectedDate);
    if (version !== loadingVersion) return;
    meals = data;
    renderDashboard();
  } catch (error) {
    if (version !== loadingVersion) return;
    $('mealList').textContent = 'Daten konnten nicht geladen werden.';
    message(error.message, true);
  }
}
async function initializeMeals() {
  try {
    await store.list();
    storageReadable = true;
    try {
      const legacy = localStorage.getItem('didi-meals');
      if (legacy) {
        const saved = JSON.parse(legacy);
        await store.import(saved);
        localStorage.setItem('didi-meals-backup', legacy);
        localStorage.removeItem('didi-meals');
        if (saved.length) message('Vorhandene Browserdaten wurden in den lokalen Speicher übernommen.');
      }
    } catch {
      message('Alte Browserdaten konnten nicht übernommen werden. Die Originaldaten bleiben erhalten; du kannst eine CSV-Sicherung importieren.', true);
    }
    await loadMeals();
  } catch (error) { message(error.message, true); }
  updateTotal();
}
function selectDate(date) {
  if (!validDate(date)) return;
  selectedDate = date;
  $('dayPicker').value = selectedDate;
  message();
  loadMeals();
}
function moveDay(offset) {
  const date = new Date(`${selectedDate}T12:00:00`);
  date.setDate(date.getDate() + offset);
  selectDate(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`);
}
function totals(foods) {
  return foods.reduce((sum, food) => {
    const factor = food.grams / 100;
    sum.calories += food.kcal100 * factor;
    sum.protein += food.protein100 * factor;
    sum.carbs += food.carbs100 * factor;
    sum.fat += food.fat100 * factor;
    return sum;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}
function clearPreview() {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = undefined;
  $('preview').removeAttribute('src');
  $('preview').style.display = 'none';
}
function discard() {
  requestController?.abort();
  requestController = undefined;
  currentFoods = [];
  draftId = undefined;
  clearPreview();
  $('analysisCard').style.display = 'none';
  $('photoInput').value = '';
  $('cameraButton').disabled = false;
  $('saveButton').disabled = true;
}
async function handlePhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  discard();
  message();
  if (!apiKey) { $('settings').open = true; message('Bitte zuerst deinen API-Schlüssel in den Einstellungen eintragen.', true); return; }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    message('Bitte ein JPEG-, PNG- oder WebP-Foto auswählen. HEIC-Fotos vorher als JPEG exportieren.', true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    message('Das Foto darf höchstens 10 MB groß sein. Bitte eine kleinere Datei auswählen.', true);
    return;
  }
  previewUrl = URL.createObjectURL(file);
  $('preview').src = previewUrl;
  $('preview').style.display = 'block';
  $('analysisCard').style.display = 'block';
  $('status').style.display = 'block';
  $('result').style.display = 'none';
  $('cameraButton').disabled = true;
  $('analysisCard').scrollIntoView({ behavior: 'smooth' });
  const controller = new AbortController();
  requestController = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 75000);
  try {
    const data = await analyzePhoto(file, apiKey, model, controller.signal);
    if (requestController !== controller) return;
    currentFoods = data.foods;
    $('analysisNote').textContent = data.note || 'Bitte prüfe die geschätzten Mengen vor dem Speichern.';
    $('result').style.display = 'block';
    renderFoods();
    if (!currentFoods.length) message('Kein Essen erkannt. Bitte fotografiere die Mahlzeit noch einmal deutlicher.');
  } catch (error) {
    if (requestController !== controller) return;
    if (timedOut) message('Die Analyse dauert zu lange. Bitte erneut versuchen.', true);
    else if (error.name !== 'AbortError') message(error instanceof TypeError || error instanceof SyntaxError
      ? 'OpenAI ist nicht erreichbar oder hat ungültig geantwortet. Bitte Internetverbindung prüfen.' : error.message, true);
  } finally {
    clearTimeout(timeout);
    if (requestController === controller) {
      requestController = undefined;
      $('status').style.display = 'none';
      $('cameraButton').disabled = false;
    }
  }
}
function renderFoods() {
  $('foodList').replaceChildren();
  currentFoods.forEach((food, index) => {
    const row = document.createElement('div');
    row.className = 'food-row';
    const name = document.createElement('div');
    name.textContent = food.name;
    const label = document.createElement('label');
    label.textContent = 'Gramm';
    const input = document.createElement('input');
    input.type = 'number'; input.min = '0'; input.max = '10000'; input.step = '0.1';
    input.value = food.grams;
    input.required = true;
    input.setAttribute('aria-label', `${food.name}: Menge in Gramm`);
    const kcal = document.createElement('div');
    kcal.className = 'food-kcal';
    kcal.textContent = `${Math.round(food.grams * food.kcal100 / 100)} kcal`;
    input.addEventListener('input', () => {
      if (input.validity.valid && Number.isFinite(input.valueAsNumber)) {
        currentFoods[index].grams = input.valueAsNumber;
        kcal.textContent = `${Math.round(input.valueAsNumber * food.kcal100 / 100)} kcal`;
      }
      updateTotal();
    });
    label.append(input);
    row.append(name, label, kcal);
    $('foodList').append(row);
  });
  updateTotal();
}
function updateTotal() {
  $('analysisCalories').textContent = `${Math.round(totals(currentFoods).calories)} kcal`;
  $('saveButton').disabled = saving || !storageReadable || !currentFoods.some(food => food.grams > 0) ||
    [...$('foodList').querySelectorAll('input')].some(input => !input.validity.valid);
}
async function saveMeal() {
  if ($('saveButton').disabled || !currentFoods.length || requestController) return;
  const values = totals(currentFoods);
  draftId ||= typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const meal = {
    id: draftId, date: selectedDate, time: localTime(),
    title: currentFoods.filter(food => food.grams > 0).slice(0, 2).map(food => food.name).join(' + '),
    foods: currentFoods.map(food => ({ ...food })),
    ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Math.round(value)])),
  };
  saving = true;
  updateTotal();
  $('cancelButton').disabled = true;
  $('cameraButton').disabled = true;
  try {
    await store.add(meal);
    discard();
    await loadMeals();
    message(`Mahlzeit für ${new Intl.DateTimeFormat('de-DE').format(new Date(meal.date + 'T12:00:00'))} auf diesem Gerät gespeichert.`);
  } catch (error) {
    message(`Speichern fehlgeschlagen: ${error.message} Deine Analyse bleibt erhalten.`, true);
  } finally {
    saving = false;
    $('cancelButton').disabled = false;
    $('cameraButton').disabled = false;
    updateTotal();
  }
}
function renderDashboard() {
  $('date').textContent = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(selectedDate + 'T12:00:00'));
  $('dayTitle').textContent = selectedDate === localDate() ? 'Heute' : new Intl.DateTimeFormat('de-DE').format(new Date(selectedDate + 'T12:00:00'));
  $('saveDate').textContent = `Speichern für ${new Intl.DateTimeFormat('de-DE').format(new Date(selectedDate + 'T12:00:00'))}`;
  const todayMeals = meals.filter(meal => meal.date === selectedDate);
  const sum = todayMeals.reduce((result, meal) => {
    for (const field of ['calories', 'protein', 'carbs', 'fat']) result[field] += meal[field];
    return result;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  $('totalCalories').textContent = sum.calories.toLocaleString('de-DE');
  const remaining = DAILY_GOAL - sum.calories;
  $('remaining').textContent = `${Math.abs(remaining).toLocaleString('de-DE')} ${remaining >= 0 ? 'übrig' : 'darüber'}`;
  for (const field of ['protein', 'carbs', 'fat']) $(field).textContent = `${Math.round(sum[field])} g`;
  $('progressBar').style.width = `${Math.min(100, sum.calories / DAILY_GOAL * 100)}%`;
  $('mealList').replaceChildren();
  if (!todayMeals.length) {
    const empty = document.createElement('div');
    empty.className = 'empty'; empty.textContent = 'Noch keine Mahlzeit erfasst.';
    $('mealList').append(empty);
  }
  todayMeals.slice().reverse().forEach(meal => {
    const row = document.createElement('div'); row.className = 'meal';
    const detail = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = meal.title;
    const macros = document.createElement('small');
    macros.textContent = `${meal.protein} g Protein · ${meal.carbs} g KH · ${meal.fat} g Fett`;
    detail.append(title, document.createElement('br'));
    if (meal.time) {
      const time = document.createElement('small');
      time.textContent = `${meal.time.slice(0, 5)} Uhr · `;
      detail.append(time);
    }
    detail.append(macros);
    const actions = document.createElement('div');
    const kcal = document.createElement('strong'); kcal.textContent = `${meal.calories} kcal`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete'; remove.textContent = '×';
    remove.setAttribute('aria-label', `${meal.title} löschen`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await store.remove(meal.id);
        await loadMeals();
        message('Mahlzeit auf diesem Gerät gelöscht.');
      } catch (error) { message(error.message, true); remove.disabled = false; }
    });
    actions.append(kcal, remove); row.append(detail, actions); $('mealList').append(row);
  });
}
$('cameraButton').addEventListener('click', () => $('photoInput').click());
$('photoInput').addEventListener('change', handlePhoto);
$('saveButton').addEventListener('click', saveMeal);
$('cancelButton').addEventListener('click', discard);
$('dayPicker').value = selectedDate;
$('dayPicker').addEventListener('change', event => selectDate(event.target.value));
$('previousDay').addEventListener('click', () => moveDay(-1));
$('nextDay').addEventListener('click', () => moveDay(1));
$('todayButton').addEventListener('click', () => selectDate(localDate()));
$('reloadDay').addEventListener('click', () => { message(); loadMeals(); });
$('rangeStart').value = localDate();
$('rangeEnd').value = localDate();
$('calculateRange').addEventListener('click', async () => {
  const start = $('rangeStart').value;
  const end = $('rangeEnd').value;
  $('rangeResult').hidden = true;
  if (!validDate(start) || !validDate(end)) {
    message('Bitte für den Zeitraum ein gültiges Start- und Enddatum wählen.', true);
    return;
  }
  if (start > end) {
    message('Das Startdatum muss vor oder am Enddatum liegen.', true);
    return;
  }
  $('calculateRange').disabled = true;
  try {
    const rangeMeals = await store.range(start, end);
    const calories = rangeMeals.reduce((sum, meal) => sum + meal.calories, 0);
    const days = Math.round((new Date(`${end}T12:00:00`) - new Date(`${start}T12:00:00`)) / 86400000) + 1;
    $('rangeCalories').textContent = Math.round(calories).toLocaleString('de-DE');
    $('rangeDetails').textContent = `${new Intl.DateTimeFormat('de-DE').format(new Date(`${start}T12:00:00`))} bis ${new Intl.DateTimeFormat('de-DE').format(new Date(`${end}T12:00:00`))} · ${days} Tag${days === 1 ? '' : 'e'} · ${rangeMeals.length} Mahlzeit${rangeMeals.length === 1 ? '' : 'en'}`;
    $('rangeResult').hidden = false;
    message();
  } catch (error) { message(error.message, true); }
  finally { $('calculateRange').disabled = false; }
});
renderDashboard();
initializeMeals();

function loadSettings() {
  try {
    apiKey = localStorage.getItem('didi-api-key') || '';
    model = localStorage.getItem('didi-model') || 'gpt-6-luna';
  } catch { /* Session-only use still works when localStorage is unavailable. */ }
  $('apiKey').value = apiKey;
  $('model').value = model;
  $('rememberKey').checked = Boolean(apiKey);
  $('keyState').textContent = apiKey ? 'API-Schlüssel auf diesem Gerät gespeichert.' : 'Noch kein API-Schlüssel hinterlegt. Kalender und CSV funktionieren ohne Schlüssel.';
}
$('settingsForm').addEventListener('submit', event => {
  event.preventDefault();
  const nextKey = $('apiKey').value.trim();
  const nextModel = $('model').value.trim();
  if (!nextKey || !nextModel) return;
  try {
    if ($('rememberKey').checked) localStorage.setItem('didi-api-key', nextKey);
    else localStorage.removeItem('didi-api-key');
    localStorage.setItem('didi-model', nextModel);
  } catch {
    message('Einstellungen konnten nicht dauerhaft gespeichert werden. Der Schlüssel wird nur für diese Sitzung verwendet.', true);
    apiKey = nextKey; model = nextModel;
    $('keyState').textContent = 'Schlüssel für diese Sitzung verfügbar; lokale Speicherung fehlgeschlagen.';
    return;
  }
  apiKey = nextKey; model = nextModel;
  $('keyState').textContent = $('rememberKey').checked ? 'API-Schlüssel auf diesem Gerät gespeichert.' : 'API-Schlüssel nur bis zum Schließen oder Neuladen verfügbar.';
  message('Einstellungen übernommen.');
});
$('forgetKey').addEventListener('click', () => {
  apiKey = ''; $('apiKey').value = ''; $('rememberKey').checked = false;
  try { localStorage.removeItem('didi-api-key'); $('keyState').textContent = 'API-Schlüssel entfernt.'; }
  catch { message('Gespeicherten Schlüssel bitte über die Website-Daten in Safari entfernen.', true); }
});
async function exportCSV(all = false) {
  try {
    const data = await store.list(all ? undefined : selectedDate);
    const url = URL.createObjectURL(new Blob([toCSV(data)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `didi-${all ? 'alle-tage' : selectedDate}_gesichert-${fileTimestamp()}.csv`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    message('CSV-Download gestartet. Auf dem iPad in „Dateien“ sichern.');
  } catch (error) { message(error.message, true); }
}
$('csvDownload').addEventListener('click', () => exportCSV());
$('exportAll').addEventListener('click', () => exportCSV(true));
$('importButton').addEventListener('click', () => $('csvInput').click());
$('csvInput').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  $('importButton').disabled = true;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('Die CSV-Datei darf höchstens 10 MB groß sein.');
    let data;
    try { data = parseCSV(await file.text()); }
    catch { throw new Error('Die Datei ist keine gültige Didi-CSV. Bestehende Mahlzeiten bleiben unverändert.'); }
    const count = await store.import(data);
    await loadMeals();
    message(`${count} Mahlzeit(en) importiert. Bereits vorhandene IDs wurden übersprungen. Wähle das gewünschte Datum im Kalender.`);
  } catch (error) { message(error.message, true); }
  finally { event.target.value = ''; $('importButton').disabled = false; }
});
loadSettings();
function connectionStatus() {
  $('connection').textContent = navigator.onLine ? 'Lokal gespeichert · Fotoanalyse benötigt Internet' : 'Offline · Kalender und Mahlzeiten verfügbar';
}
window.addEventListener('online', connectionStatus);
window.addEventListener('offline', connectionStatus);
connectionStatus();
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./sw.js').then(async () => {
    await navigator.serviceWorker.ready;
    $('offlineState').textContent = 'Offline-Start vorbereitet. Auf dem iPad über Teilen → Zum Home-Bildschirm installieren.';
  }).catch(() => { $('offlineState').textContent = 'Offline-Start konnte nicht eingerichtet werden. Bitte online neu laden.'; });
} else {
  $('offlineState').textContent = 'Für Installation und Offline-Start diese App über eine HTTPS-Adresse öffnen.';
}
$('protectStorage').addEventListener('click', async () => {
  try {
    const granted = await navigator.storage?.persist?.();
    message(granted ? 'Dauerhafter Gerätespeicher wurde gewährt. CSV-Sicherungen bleiben sinnvoll.' : 'Dauerhafter Speicher wurde nicht zugesagt. Bitte regelmäßig alle Tage als CSV sichern.');
  } catch { message('Bitte regelmäßig alle Tage als CSV sichern.'); }
});
