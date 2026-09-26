import { validateMeal } from './csv.js';
let database;
function open() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('didi-personal', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('meals', { keyPath: 'id' });
      store.createIndex('date', 'date');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(new Error('Der lokale Speicher ist nicht verfügbar. Bitte Safari-Speichereinstellungen prüfen.')); };
    request.onblocked = () => { database = undefined; reject(new Error('Bitte andere Didi-Fenster schließen und erneut öffnen.')); };
  });
  return database;
}
async function transaction(mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meals', mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(new Error('Lokale Speicherung fehlgeschlagen. Bitte freien Speicher prüfen.'));
    tx.onerror = () => {};
    action(tx.objectStore('meals'), value => { result = value; });
  });
}
export const store = {
  async list(date) {
    return transaction('readonly', (table, done) => {
      const request = date ? table.index('date').getAll(date) : table.getAll();
      request.onsuccess = () => done(request.result);
    });
  },
  async add(input) {
    const meal = validateMeal(input);
    return transaction('readwrite', table => table.put(meal));
  },
  async remove(id) { return transaction('readwrite', table => table.delete(String(id))); },
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
