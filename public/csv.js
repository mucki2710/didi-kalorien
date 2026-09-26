const columns = ['id', 'date', 'title', 'calories', 'protein', 'carbs', 'fat', 'foods'];
const nutrients = ['calories', 'protein', 'carbs', 'fat'];
export function validDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function validateMeal(meal) {
  if (!meal || !validDate(meal.date) || !['string', 'number'].includes(typeof meal.id) ||
      !/^[a-zA-Z0-9-]{1,100}$/.test(String(meal.id)) || typeof meal.title !== 'string' ||
      !meal.title.trim() || meal.title.length > 500 ||
      !nutrients.every(key => Number.isFinite(meal[key]) && meal[key] >= 0 && meal[key] <= 1000000) ||
      !Array.isArray(meal.foods) || meal.foods.length > 100 || !meal.foods.every(food => food &&
        typeof food.name === 'string' && food.name.length <= 500 &&
        ['grams', 'kcal100', 'protein100', 'carbs100', 'fat100'].every(key => Number.isFinite(food[key]) && food[key] >= 0 && food[key] <= 10000))) {
    const error = new Error('Die Mahlzeit enthält ungültige Daten.'); error.status = 400; throw error;
  }
  return { id: String(meal.id), date: meal.date, title: meal.title,
    ...Object.fromEntries(nutrients.map(key => [key, meal[key]])), foods: meal.foods };
}
// Quote every cell; escape spreadsheet formulas in textual cells reversibly.
function cell(value) {
  const text = String(value);
  const safe = /^[=+\-@\t\r\n']/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}
export function toCSV(meals) {
  return '\ufeff' + columns.join(';') + '\r\n' + meals.map(meal => columns.map(key =>
    cell(key === 'foods' ? JSON.stringify(meal.foods) : meal[key])).join(';') + '\r\n').join('');
}
export function parseCSV(text) {
  text = text.replace(/^\ufeff/, '');
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ';') { row.push(value); value = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(value); rows.push(row); row = []; value = '';
    } else value += c;
  }
  if (quoted) throw new Error('Unclosed CSV field');
  if (value || row.length) { row.push(value); rows.push(row); }
  if (rows.shift()?.join(';') !== columns.join(';')) throw new Error('Invalid CSV header');
  return rows.map(row => {
    if (row.length !== columns.length) throw new Error('Invalid CSV row');
    const meal = Object.fromEntries(columns.map((key, index) => [key, row[index].replace(/^'/, '')]));
    for (const key of nutrients) meal[key] = Number(meal[key]);
    meal.foods = JSON.parse(meal.foods);
    return validateMeal(meal);
  });
}
