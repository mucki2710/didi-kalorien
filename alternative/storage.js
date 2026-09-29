import { validateMeal } from './csv.js';
let database;
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('didi-personal', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      const meals = db.objectStoreNames.contains('meals')
        ? transaction.objectStore('meals')
        : db.createObjectStore('meals', { keyPath: 'id' });
      if (!meals.indexNames.contains('date')) meals.createIndex('date', 'date');
      const textAnalyses = db.objectStoreNames.contains('text-analyses')
        ? transaction.objectStore('text-analyses')
        : db.createObjectStore('text-analyses', { keyPath: 'key' });
      if (!textAnalyses.indexNames.contains('mealId')) textAnalyses.createIndex('mealId', 'mealId');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('Der lokale Speicher ist nicht verfügbar. Bitte Safari-Speichereinstellungen prüfen.')); };
    request.onblocked = () => { database = undefined; reject(new Error('Bitte andere Didi-Fenster schließen und erneut öffnen.')); };
  });
  return database;
}
async function transaction(mode, action, storeName = 'meals') {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(new Error('Lokale Speicherung fehlgeschlagen. Bitte freien Speicher prüfen.'));
    tx.onerror = () => {};
    action(tx.objectStore(storeName), value => { result = value; });
  });
}
async function textAnalysisKey(text, portionSize, model) {
  if (!globalThis.crypto?.subtle || typeof text !== 'string') return '';
  const normalized = text.normalize('NFC').trim().toLocaleLowerCase('de-DE').replace(/\s+/g, ' ');
  if (!normalized) return '';
  const source = `${normalized}\u0000portion:${portionSize || ''}\u0000model:${model || ''}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function validCachedFoods(foods) {
  return Array.isArray(foods) && foods.length > 0 && foods.length <= 100 && foods.every(food => food &&
    typeof food.name === 'string' && Number.isFinite(food.grams) && food.grams >= 0 &&
    ['kcal100', 'protein100', 'carbs100', 'fat100'].every(field => Number.isFinite(food[field]) && food[field] >= 0));
}
export const store = {
  async list(date) {
    return transaction('readonly', (table, done) => {
      const request = date ? table.index('date').getAll(date) : table.getAll();
      request.onsuccess = () => done(request.result);
    });
  },
  async range(start, end) {
    return transaction('readonly', (table, done) => {
      const request = table.index('date').getAll(IDBKeyRange.bound(start, end));
      request.onsuccess = () => done(request.result);
    });
  },
  async add(input) {
    const meal = validateMeal(input);
    return transaction('readwrite', table => table.put(meal));
  },
  async findTextAnalysis(text, portionSize, model) {
    const key = await textAnalysisKey(text, portionSize, model);
    if (!key) return null;
    return transaction('readonly', (table, done) => {
      const request = table.get(key);
      request.onsuccess = () => done(validCachedFoods(request.result?.foods) ? request.result.foods : null);
    }, 'text-analyses');
  },
  async saveTextAnalysis(text, portionSize, model, foods, mealId) {
    const key = await textAnalysisKey(text, portionSize, model);
    if (!key || !validCachedFoods(foods)) return;
    const cached = foods.map(food => ({
      name: food.name,
      grams: food.grams,
      kcal100: food.kcal100,
      protein100: food.protein100,
      carbs100: food.carbs100,
      fat100: food.fat100,
    }));
    return transaction('readwrite', table => table.put({ key, foods: cached, mealId: String(mealId), updatedAt: Date.now() }), 'text-analyses');
  },
  async remove(id) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['meals', 'text-analyses'], 'readwrite');
      const cache = tx.objectStore('text-analyses');
      tx.objectStore('meals').delete(String(id));
      const request = cache.index('mealId').openCursor(IDBKeyRange.only(String(id)));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cache.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new Error('Lokale Speicherung fehlgeschlagen. Bitte freien Speicher prüfen.'));
      tx.onerror = () => {};
    });
  },
  async import(inputs) {
    if (!Array.isArray(inputs) || inputs.length > 10000) throw new Error('Die CSV-Datei enthält zu viele oder ungültige Mahlzeiten.');
    const meals = [...new Map(inputs.map(input => { const meal = validateMeal(input); return [meal.id, meal]; })).values()];
    return transaction('readwrite', (table, done) => {
      let count = 0;
      for (const meal of meals) {
        const request = table.get(meal.id);
        request.onsuccess = () => { if (!request.result) { table.put(meal); count++; } };
      }
      // All requests, including puts scheduled by their handlers, finish before commit.
      const countRequest = table.count();
      countRequest.onsuccess = () => done(count);
    });
  },
};
