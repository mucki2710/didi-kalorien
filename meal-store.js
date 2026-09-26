import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { validateMeal, parseCSV, toCSV } from './public/csv.js';
export { validDate, toCSV } from './public/csv.js';

export function createMealStore(directory) {
  const file = join(directory, 'meals.csv');
  let queue = Promise.resolve();
  async function read() {
    try { return parseCSV(await readFile(file, 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') return [];
      throw new Error('Die CSV-Datei konnte nicht gelesen werden. Vorhandene Daten bleiben unverändert.');
    }
  }
  function change(update) {
    const operation = queue.then(async () => {
      const meals = await read();
      const next = update(meals);
      await mkdir(directory, { recursive: true });
      const temp = `${file}.${randomUUID()}.tmp`;
      await writeFile(temp, toCSV(next), { encoding: 'utf8', mode: 0o600 });
      await rename(temp, file);
      return next;
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    async list(date) { await queue; const meals = await read(); return date ? meals.filter(meal => meal.date === date) : meals; },
    async add(input) {
      const meal = validateMeal(input);
      await change(meals => {
        const existing = meals.find(item => item.id === meal.id);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(meal)) { const error = new Error('Diese Mahlzeit-ID ist bereits vergeben.'); error.status = 409; throw error; }
          return meals;
        }
        return [...meals, meal];
      });
      return meal;
    },
    async import(inputs) {
      if (!Array.isArray(inputs) || inputs.length > 10000) { const error = new Error('Ungültiger Import.'); error.status = 400; throw error; }
      const incoming = inputs.map(validateMeal);
      await change(meals => {
        const ids = new Set(meals.map(meal => meal.id));
        const result = [...meals];
        for (const meal of incoming) if (!ids.has(meal.id)) { result.push(meal); ids.add(meal.id); }
        return result;
      });
    },
    async remove(id) { await change(meals => meals.filter(meal => meal.id !== id)); },
  };
}
