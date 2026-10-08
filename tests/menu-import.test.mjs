import { readFileSync } from 'node:fs'
import { readXlsx, parseDelimited, menuRows, matchCourse, isVegValue, menuTemplateCsv, detectColumns } from '../src/lib/sheetImport.js'
let fails = 0
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++ }
const buf = readFileSync(new URL('./fixtures/menu.xlsx', import.meta.url))
const rows = await readXlsx(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
ok(rows[0][0] === 'Jay Caterers — Wedding menu', 'xlsx: title row read with unicode')
const { dishes, cols, problems } = menuRows(rows)
ok(dishes.length === 7 && !problems.length, 'xlsx: 7 dishes under the header row (title + blank skipped): ' + dishes.length)
ok(cols.name === 2 && cols.category === 0 && cols.course === 1 && cols.veg === 4 && cols.barker === 5, 'columns detected ' + JSON.stringify(cols))
const tom = dishes.find(d => d.name === 'Tom Yum')
ok(tom && tom.is_veg === false && tom.barker === 'B' && tom.category === 'Asian', 'Tom Yum non-veg, barker B, Asian')
ok(dishes.find(d => d.name === 'Paneer Tikka').barker === 'A', 'barker "a" -> A')
ok(dishes.find(d => d.name.startsWith('Butter Chicken')).is_veg === false && dishes.some(d => d.name.includes('₹')), 'Chicken -> non-veg, ₹ kept')
ok(dishes.find(d => d.name === 'Cream of Tomato').description === 'Basil & croutons, "fresh"', 'xml entities decoded')
const C = ['First Course', 'Soup', 'Starters', 'Mains', 'Dessert']
ok(matchCourse('Soups', C) === 'Soup' && matchCourse('Main Course', C) === 'Mains' && matchCourse('Desserts', C) === 'Dessert' && matchCourse('Starter', C) === 'Starters', 'course synonyms match the event courses')
ok(matchCourse('Salads', C) === null && matchCourse('first course', C) === 'First Course', 'unknown course is null; case-insensitive')
// paste from Excel (tabs) with quoted multi-line cell
const pasted = 'Dish\tCourse\tCuisine\tVeg\nMinestrone\tSoup\tItalian\tVeg\n"Dal\nMakhani"\tMains\tIndian\tveg\nSOUPS\t\t\t\nLaksa\tSoup\tAsian\tNV\n'
const p = menuRows(parseDelimited(pasted))
ok(p.dishes.length === 3 && p.dishes[1].name === 'Dal\nMakhani' && p.dishes[2].is_veg === false, 'pasted rows: tabs, quoted line break, NV -> non-veg')
ok(p.dishes[2].section === 'SOUPS', 'capital heading row becomes a section, not a dish')
const csv = 'name,description,category,is_veg\n"Soup, clear",hot,Soups,no\nSalad,,Salads,yes\n'
const c = menuRows(parseDelimited(csv))
ok(c.dishes.length === 2 && c.dishes[0].name === 'Soup, clear' && c.dishes[0].is_veg === false && c.dishes[1].is_veg, 'csv with quoted comma, old column names')
ok(parseDelimited('a;b;c\n1;2;3').length === 2 && parseDelimited('a;b;c\n1;2;3')[1][2] === '3', 'semicolon CSV')
ok(isVegValue('') && isVegValue('Veg') && !isVegValue('Non Veg') && !isVegValue('egg'), 'veg values')
const t = menuRows(parseDelimited(menuTemplateCsv(C)))
ok(t.dishes.length === 5 && t.dishes.every(d => matchCourse(d.course, C)), 'template round-trips with valid courses')
ok(detectColumns(['Item', 'Section']).name === 0 && detectColumns(['Item', 'Section']).category === 1, 'Item / Section headers')
ok(menuRows([['Price', 'Qty']]).problems.length === 1, 'no dish column -> clear problem')

// review fixes: fill-down, capitals sheets, header pick, spelling variants
{
  const merged = menuRows(parseDelimited('Cuisine\tCourse\tDish\nItalian\tSoup\tMinestrone\n\t\tRibollita\nAsian\t\tTom Yum\n'))
  ok(merged.dishes.map(d => d.category + '/' + d.course).join(',') === 'Italian/Soup,Italian/Soup,Asian/Soup', 'blank cells repeat the row above (merged cells)')
  const allCaps = menuRows(parseDelimited('Dish\nTOMATO BASIL\nRIBOLLITA\nLAKSA\n'))
  ok(allCaps.dishes.length === 3 && !allCaps.headings.length, 'a sheet written in capitals keeps every dish')
  const titled = menuRows(parseDelimited('Event name: Wedding\nCuisine,Course,Dish Name,Description\nItalian,Soup,Minestrone,Beans\n'))
  ok(titled.dishes.length === 1 && titled.dishes[0].category === 'Italian', 'header row is the one with the most known columns')
  const cn = detectColumns(['Course Name', 'Menu Item Name', 'Cuisine'])
  ok(cn.name === 1 && cn.course === 0, '"Course Name" is the course, "Menu Item Name" the dish: ' + JSON.stringify(cn))
  const CC = ['First Course', 'Canapés', 'Soup', 'Salad', 'Appetiser', 'Main Course', 'Dessert']
  ok(matchCourse('Canapes', CC) === 'Canapés' && matchCourse('Appetizers', CC) === 'Appetiser' && matchCourse('Mains', CC) === 'Main Course', 'Canapes / Appetizers / Mains match')
  const heads = menuRows(parseDelimited('Dish\tVeg\nSOUPS\t\nMinestrone\tVeg\nMAINS\t\nRisotto\tVeg\n'))
  ok(heads.headings.join(',') === 'SOUPS,MAINS' && heads.dishes[1].section === 'MAINS', 'heading rows are reported')
}
console.log(fails ? fails + ' FAILED' : 'all passed'); process.exitCode = fails ? 1 : 0
