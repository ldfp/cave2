const xlsx = require('xlsx');
const fs = require('fs');

try {
  const workbook = xlsx.readFile('macaveavin.xlsx');
  const sheetName = workbook.SheetNames[0];
  const data = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
  
  fs.writeFileSync('src/db.json', JSON.stringify({ bottles: data }, null, 2));
  console.log("Parsed " + data.length + " rows.");
  console.log("Sample data:");
  console.log(JSON.stringify(data.slice(0, 2), null, 2));
} catch (error) {
  console.error("Error reading excel file:", error);
}
