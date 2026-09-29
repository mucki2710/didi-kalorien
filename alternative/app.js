import { store } from './storage.js';
import { toCSV, parseCSV, validDate } from './csv.js';
import { analyzePhoto, analyzeText } from './openai.js';
const DEFAULT_DAILY_GOAL = 2200;
const $ = id => document.getElementById(id);
const fields = ['grams', 'kcal100', 'protein100', 'carbs100', 'fat100'];
let currentFoods = [];
let meals = [];
let previewUrl;
let secondPreviewUrl;
let currentPhoto;
let secondPhoto;
let requestController;
let storageReadable = false;
let selectedDate = localDate();
let loadingVersion = 0;
let saving = false;
let draftId;
let manualMealLabel = '';
let apiKey = '';
let updateReloadPending = false;
const AVAILABLE_MODELS = ['gpt-6-sol', 'gpt-6-astra', 'gpt-6-luna'];
let model = 'gpt-6-sol';
let dailyGoal = DEFAULT_DAILY_GOAL;

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
  if (secondPreviewUrl) URL.revokeObjectURL(secondPreviewUrl);
  previewUrl = undefined;
  secondPreviewUrl = undefined;
  $('preview').removeAttribute('src');
  $('preview').style.display = 'none';
  $('previewSecond').removeAttribute('src');
  $('previewSecond').style.display = 'none';
}
function discard() {
  requestController?.abort();
  requestController = undefined;
  currentFoods = [];
  draftId = undefined;
  manualMealLabel = '';
  currentPhoto = undefined;
  secondPhoto = undefined;
  $('mealHint').value = '';
  $('mealSearchText').value = '';
  $('photoDescription').value = '';
  preserveTextDraft();
  clearPreview();
  $('analysisCard').style.display = 'none';
  $('photoInput').value = '';
  $('secondPhotoInput').value = '';
  $('secondPhotoButton').disabled = true;
  $('cameraButton').disabled = false;
  $('saveButton').disabled = true;
}
async function handlePhoto(event) {
  const file = event.target.files[0];
  if (!file) return;
  const description = $('photoDescription').value.trim();
  discard();
  message();
  if (!apiKey) { document.querySelector('[data-tab="settings"]').click(); message('Bitte zuerst deinen API-Schlüssel in den Einstellungen eintragen.', true); return; }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    message('Bitte ein JPEG-, PNG- oder WebP-Foto auswählen. HEIC-Fotos vorher als JPEG exportieren.', true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    message('Das Foto darf höchstens 10 MB groß sein. Bitte eine kleinere Datei auswählen.', true);
    return;
  }
  previewUrl = URL.createObjectURL(file);
  currentPhoto = file;
  $('preview').src = previewUrl;
  $('preview').style.display = 'block';
  $('analysisCard').style.display = 'block';
  $('secondPhotoButton').disabled = false;
  $('cameraButton').disabled = true;
  $('analysisCard').scrollIntoView({ behavior: 'smooth' });
  $('photoDescription').value = '';
  await runPhotoAnalysis([file], description);
}
function validPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    message('Bitte ein JPEG-, PNG- oder WebP-Foto auswählen.', true); return false;
  }
  if (file.size > 10 * 1024 * 1024) {
    message('Jedes Foto darf höchstens 10 MB groß sein.', true); return false;
  }
  return true;
}
$('secondPhotoButton').addEventListener('click', () => $('secondPhotoInput').click());
$('secondPhotoInput').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file || !currentPhoto || !validPhoto(file)) return;
  secondPhoto = file;
  if (secondPreviewUrl) URL.revokeObjectURL(secondPreviewUrl);
  secondPreviewUrl = URL.createObjectURL(file);
  $('previewSecond').src = secondPreviewUrl;
  $('previewSecond').style.display = 'block';
  message();
  await runPhotoAnalysis([currentPhoto, secondPhoto], $('photoDescription').value.trim(), true);
});
function applyAnalysis(data, enforcedLabel = '') {
  if (enforcedLabel && data.foods.length) {
    manualMealLabel = enforcedLabel.trim().slice(0, 500);
    data.foods[0] = { ...data.foods[0], name: manualMealLabel };
  } else manualMealLabel = '';
  currentFoods = data.foods;
  $('analysisNote').textContent = manualMealLabel
    ? `Eigene Kennzeichnung übernommen: ${manualMealLabel}. ${data.note || 'Bitte prüfe die geschätzten Mengen.'}`
      : data.note || 'Bitte prüfe die geschätzten Mengen vor dem Speichern.';
  $('correctionPanel').hidden = !currentPhoto;
  $('result').style.display = 'block';
  renderFoods();
  if (!currentFoods.length) message('Keine ausreichenden Angaben erkannt. Bitte Foto oder Beschreibung ergänzen.');
}
async function runPhotoAnalysis(files, mealHint = '', keepResult = false, enforceLabel = false) {
  $('status').textContent = mealHint ? '🔍 Mahlzeit wird mit deiner Beschreibung neu analysiert …' : '🔍 Mahlzeit wird analysiert …';
  $('status').style.display = 'block';
  if (!keepResult) $('result').style.display = 'none';
  $('reanalyzeButton').disabled = true;
  $('saveButton').disabled = true;
  const controller = new AbortController();
  requestController = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 75000);
  try {
    const data = await analyzePhoto(files, apiKey, model, controller.signal, mealHint, $('portionSize').value, enforceLabel);
    if (requestController !== controller) return;
    applyAnalysis(data, enforceLabel ? mealHint : '');
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
      $('reanalyzeButton').disabled = false;
      updateTotal();
    }
  }
}
$('reanalyzeButton').addEventListener('click', async () => {
  const hint = $('mealHint').value.trim();
  if (!currentPhoto || requestController) return;
  if (!hint) {
    message('Bitte beschreibe zuerst kurz, was auf dem Teller ist.', true);
    $('mealHint').focus();
    return;
  }
  message();
  await runPhotoAnalysis([currentPhoto, secondPhoto].filter(Boolean), hint, true, true);
});
$('textAnalysisButton').addEventListener('click', async () => {
  const description = $('mealSearchText').value.trim();
  if (!description) {
    message('Bitte die Mahlzeit zuerst beschreiben oder über „Text sprechen“ diktieren.', true);
    $('mealSearchText').focus();
    return;
  }
  if (!apiKey) { document.querySelector('[data-tab="settings"]').click(); message('Bitte zuerst deinen API-Schlüssel in den Einstellungen eintragen.', true); return; }
  message();
  $('mealSearchText').value = '';
  preserveTextDraft();
  if (currentPhoto) {
    await runPhotoAnalysis([currentPhoto, secondPhoto].filter(Boolean), description, true);
    return;
  }
  $('analysisCard').style.display = 'block';
  $('analysisCard').scrollIntoView({ behavior: 'smooth' });
  $('status').textContent = '🔍 Beschreibung wird analysiert …';
  $('status').style.display = 'block';
  $('result').style.display = 'none';
  $('textAnalysisButton').disabled = true;
  $('cameraButton').disabled = true;
  const controller = new AbortController();
  requestController = controller;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 75000);
  try {
    const data = await analyzeText(description, apiKey, model, controller.signal, $('portionSize').value);
    if (requestController !== controller) return;
    applyAnalysis(data);
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
      $('textAnalysisButton').disabled = false;
      $('cameraButton').disabled = false;
      updateTotal();
    }
  }
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechRecognition;
let speechTimer;
function clearSpeechText(fromVoice = false) {
  $('mealSearchText').value = '';
  $('speechState').textContent = fromVoice
    ? 'Sprachbefehl erkannt: Die Eingabe wurde gelöscht.'
    : 'Die Spracheingabe wurde gelöscht.';
  message();
}
$('clearSpeechButton').addEventListener('click', () => clearSpeechText());
if (SpeechRecognition) {
  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = 'de-DE';
  speechRecognition.interimResults = false;
  speechRecognition.continuous = false;
  speechRecognition.maxAlternatives = 1;
  speechRecognition.onstart = () => {
    $('speechButton').classList.add('listening');
    $('speechButton').textContent = '🎙️ Aufnahme läuft …';
    $('speechButton').disabled = true;
    $('speechState').textContent = 'Sprich jetzt. Nach einer kurzen Pause endet die Aufnahme automatisch und der Text wird eingefügt.';
    clearTimeout(speechTimer);
    speechTimer = setTimeout(() => speechRecognition.stop(), 30000);
  };
  speechRecognition.onresult = event => {
    for (let index = event.resultIndex ?? 0; index < event.results.length; index++) {
      if (event.results[index].isFinal === false) continue;
      const spoken = event.results[index][0].transcript.trim();
      const command = spoken.toLocaleLowerCase('de-DE').replace(/[.!?]/g, '').trim();
      if (/^(eingabe|text|alles) löschen$/.test(command)) clearSpeechText(true);
      else {
        $('mealSearchText').value = [$('mealSearchText').value.trim(), spoken].filter(Boolean).join(' ');
        $('speechState').textContent = 'Gesprochener Text wurde übernommen. Aufnahme beendet.';
      }
    }
  };
  speechRecognition.onerror = event => {
    clearTimeout(speechTimer);
    $('speechState').textContent = event.error === 'not-allowed'
      ? 'Mikrofonzugriff wurde nicht erlaubt. Bitte in den Browser-Einstellungen freigeben.'
      : 'Spracheingabe war nicht möglich. Bitte erneut versuchen oder Text eingeben.';
  };
  speechRecognition.onend = () => {
    clearTimeout(speechTimer);
    $('speechButton').classList.remove('listening');
    $('speechButton').textContent = '🎙️ Aufnahme starten';
    $('speechButton').disabled = false;
  };
  $('speechButton').addEventListener('click', () => {
    try { speechRecognition.start(); }
    catch { $('speechState').textContent = 'Aufnahme konnte nicht gestartet werden. Bitte erneut versuchen oder die Mikrofontaste der Tastatur verwenden.'; }
  });
} else {
  $('speechButton').disabled = true;
  $('speechState').textContent = 'Direkte Spracheingabe wird von diesem Browser nicht unterstützt. Auf dem iPad kann die Mikrofontaste der Bildschirmtastatur verwendet werden.';
}
function renderFoods() {
  $('foodList').replaceChildren();
  currentFoods.forEach((food, index) => {
    const row = document.createElement('div');
    row.className = 'food-row';
    const name = document.createElement('input');
    name.type = 'text'; name.maxLength = 120; name.required = true;
    name.className = 'food-name'; name.value = food.name;
    name.setAttribute('aria-label', `Lebensmittel ${index + 1}`);
    name.addEventListener('input', () => {
      currentFoods[index].name = name.value.trim();
      manualMealLabel = '';
      updateTotal();
    });
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
    title: manualMealLabel || currentFoods.filter(food => food.grams > 0).slice(0, 2).map(food => food.name).join(' + '),
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
  const remaining = dailyGoal - sum.calories;
  $('dailyGoalDisplay').textContent = dailyGoal.toLocaleString('de-DE');
  $('remaining').textContent = remaining > 0
    ? `Noch ${Math.round(remaining).toLocaleString('de-DE')} kcal bis zum Ziel`
    : `Ziel erreicht · ${Math.round(Math.abs(remaining)).toLocaleString('de-DE')} kcal zusätzlich`;
  for (const field of ['protein', 'carbs', 'fat']) $(field).textContent = `${Math.round(sum[field])} g`;
  $('progressBar').style.width = `${Math.min(100, sum.calories / dailyGoal * 100)}%`;
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
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'delete'; remove.textContent = '🗑️';
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

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const selectedTab = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(button => {
      const active = button === tab;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('.panel').forEach(panel => {
      panel.hidden = !panel.dataset.panel.split(' ').includes(selectedTab);
    });
  });
});
document.querySelector('.tab.is-active')?.click();

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
    const savedModel = localStorage.getItem('didi-model');
    const modelSelectionVersion = localStorage.getItem('didi-model-selection-version');
    model = modelSelectionVersion === '2' && AVAILABLE_MODELS.includes(savedModel) ? savedModel : 'gpt-6-sol';
    if (modelSelectionVersion !== '2') {
      localStorage.setItem('didi-model', model);
      localStorage.setItem('didi-model-selection-version', '2');
    }
    const savedGoal = Number(localStorage.getItem('didi-daily-goal'));
    if (Number.isInteger(savedGoal) && savedGoal >= 500 && savedGoal <= 10000) dailyGoal = savedGoal;
    const savedPortion = localStorage.getItem('didi-portion-size');
    if (['', 'small', 'medium', 'large'].includes(savedPortion)) $('portionSize').value = savedPortion;
  } catch { /* Session-only use still works when localStorage is unavailable. */ }
  $('dailyGoal').value = dailyGoal;
  $('apiKey').value = apiKey;
  $('model').value = model;
  $('rememberKey').checked = Boolean(apiKey);
  $('keyState').textContent = apiKey ? 'API-Schlüssel auf diesem Gerät gespeichert.' : 'Noch kein API-Schlüssel hinterlegt. Kalender und CSV funktionieren ohne Schlüssel.';
  renderDashboard();
}
$('goalForm').addEventListener('submit', event => {
  event.preventDefault();
  const nextGoal = Number($('dailyGoal').value);
  if (!Number.isInteger(nextGoal) || nextGoal < 500 || nextGoal > 10000) {
    message('Bitte ein Tagesziel zwischen 500 und 10.000 kcal eintragen.', true);
    return;
  }
  dailyGoal = nextGoal;
  try { localStorage.setItem('didi-daily-goal', String(dailyGoal)); }
  catch { message('Das Tagesziel konnte auf diesem Gerät nicht dauerhaft gespeichert werden.', true); renderDashboard(); return; }
  renderDashboard();
  message(`Tagesziel auf ${dailyGoal.toLocaleString('de-DE')} kcal gesetzt.`);
});
$('settingsForm').addEventListener('submit', event => {
  event.preventDefault();
  const nextKey = $('apiKey').value.trim();
  const nextModel = $('model').value;
  if (!nextKey || !AVAILABLE_MODELS.includes(nextModel)) return;
  try {
    if ($('rememberKey').checked) localStorage.setItem('didi-api-key', nextKey);
    else localStorage.removeItem('didi-api-key');
    localStorage.setItem('didi-model', nextModel);
    localStorage.setItem('didi-portion-size', $('portionSize').value);
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
function restoreTextDraft() {
  try {
    const draft = JSON.parse(sessionStorage.getItem('didi-update-draft') || '{}');
    if (typeof draft.mealSearchText === 'string') $('mealSearchText').value = draft.mealSearchText;
    if (typeof draft.photoDescription === 'string') $('photoDescription').value = draft.photoDescription;
    sessionStorage.removeItem('didi-update-draft');
  } catch { /* Session-only draft restoration is best effort. */ }
}
function preserveTextDraft() {
  try {
    sessionStorage.setItem('didi-update-draft', JSON.stringify({
      mealSearchText: $('mealSearchText').value,
      photoDescription: $('photoDescription').value,
    }));
  } catch { /* The app still updates if session storage is unavailable. */ }
}
function hasUnsavedAnalysis() {
  return Boolean(requestController || currentFoods.length || currentPhoto || secondPhoto);
}
function reloadForPendingUpdate() {
  if (!updateReloadPending || hasUnsavedAnalysis()) return;
  preserveTextDraft();
  window.location.reload();
}
restoreTextDraft();
function connectionStatus() {
  $('connection').textContent = navigator.onLine ? 'Lokal gespeichert · Sprach- und Fotoanalyse benötigt Internet' : 'Offline · Kalender und Mahlzeiten verfügbar';
}
window.addEventListener('online', connectionStatus);
window.addEventListener('offline', connectionStatus);
connectionStatus();
if ('serviceWorker' in navigator && window.isSecureContext) {
  const hadController = Boolean(navigator.serviceWorker.controller);
  let lastUpdateCheck = 0;
  const checkForAppUpdate = async () => {
    if (!navigator.onLine || Date.now() - lastUpdateCheck < 60000) return;
    lastUpdateCheck = Date.now();
    try { await (await navigator.serviceWorker.getRegistration('./'))?.update(); }
    catch { /* A failed update check does not affect offline use. */ }
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    if (hasUnsavedAnalysis()) {
      updateReloadPending = true;
      message('Neue Version bereit. Bitte die laufende Analyse speichern oder verwerfen; danach wird automatisch aktualisiert.');
      return;
    }
    preserveTextDraft();
    window.location.reload();
  });
  window.addEventListener('online', checkForAppUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForAppUpdate();
  });
  $('mealSearchText').addEventListener('input', () => {
    try { sessionStorage.setItem('didi-update-draft', JSON.stringify({ mealSearchText: $('mealSearchText').value, photoDescription: $('photoDescription').value })); } catch { /* Best effort. */ }
  });
  $('photoDescription').addEventListener('input', () => {
    try { sessionStorage.setItem('didi-update-draft', JSON.stringify({ mealSearchText: $('mealSearchText').value, photoDescription: $('photoDescription').value })); } catch { /* Best effort. */ }
  });
  navigator.serviceWorker.register('./sw.js').then(async registration => {
    await navigator.serviceWorker.ready;
    await checkForAppUpdate();
    $('offlineState').textContent = 'Offline-Start vorbereitet. Auf dem iPad über Teilen → Zum Home-Bildschirm installieren.';
  }).catch(() => { $('offlineState').textContent = 'Offline-Start konnte nicht eingerichtet werden. Bitte online neu laden.'; });
  $('cancelButton').addEventListener('click', () => reloadForPendingUpdate());
  $('saveButton').addEventListener('click', () => {
    if (!updateReloadPending) return;
    const waitForSave = () => {
      if (saving) requestAnimationFrame(waitForSave);
      else reloadForPendingUpdate();
    };
    requestAnimationFrame(waitForSave);
  });
} else {
  $('offlineState').textContent = 'Für Installation und Offline-Start diese App über eine HTTPS-Adresse öffnen.';
}
$('protectStorage').addEventListener('click', async () => {
  try {
    const granted = await navigator.storage?.persist?.();
    message(granted ? 'Dauerhafter Gerätespeicher wurde gewährt. CSV-Sicherungen bleiben sinnvoll.' : 'Dauerhafter Speicher wurde nicht zugesagt. Bitte regelmäßig alle Tage als CSV sichern.');
  } catch { message('Bitte regelmäßig alle Tage als CSV sichern.'); }
});
