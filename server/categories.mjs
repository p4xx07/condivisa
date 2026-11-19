export const predefinedCategories = [
  'Cibo e bevande', 'Casa', 'Trasporti', 'Viaggi', 'Divertimento', 'Spesa', 'Salute', 'Altro',
]

export const categoryKey = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('it').replace(/\s+/g, ' ').trim()

// Catch common Italian singular/plural variants before they become separate report rows.
export function similarCategory(name, categories) {
  const key = categoryKey(name)
  const exact = categories.find((category) => categoryKey(category) === key)
  if (exact) return exact
  const variants = (value) => {
    const result = new Set([value])
    const ending = value.at(-1)
    const stem = value.slice(0, -1)
    if (stem.length < 3) return result
    if (ending === 'a') result.add(`${stem}e`)
    if (ending === 'o') { result.add(`${stem}i`); if (value.endsWith('io')) result.add(`${value.slice(0, -2)}i`) }
    if (ending === 'e') { result.add(`${stem}a`); result.add(`${stem}i`) }
    if (ending === 'i') { result.add(`${stem}o`); result.add(`${stem}e`) }
    return result
  }
  return categories.find((category) => variants(key).has(categoryKey(category)) || variants(categoryKey(category)).has(key))
}
