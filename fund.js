////////////////////////////////////////////////////////////////////////////////
// Imports

// Dependancies
const request = require("request");
const rp = require("request-promise-native");
const cheerio = require('cheerio');

// Debugging
const verbose = require('debug')('fund:verbose');
const debug = require('debug')('fund:debug');

////////////////////////////////////////////////////////////////////////////////
// Constants

// Morningstar URLs
const fundAPIRCodeLookupURL = "https://www.morningstar.com.au/Ausearch/SecurityCodeAutoLookup";
const fundReportPrintBaseURL = "http://www.morningstar.com.au/Fund/FundReportPrint/";

// Tables we don't want to process
const ignoreTables = [
  'Performance',
  'Morningstar Sustainability Rating',
  'Current Investment Style'
];

// Tables with column headings
const hasColumnHeadings = [
  'Financial Year Returns',
  'Trailing Year Returns',
  'Risk Analysis'
];

////////////////////////////////////////////////////////////////////////////////
// 
// getSymbol(fundAPIRCode)
// 
// Returns the morningstar symbol for fund with APIR code 'fundAPIRCode'
// 

exports.getSymbol = (fundAPIRCode) => {

  return new Promise((resolve, reject) => {
    // Set the request options
    let options = {
      uri: fundAPIRCodeLookupURL,
      qs: {
          q:  '*'+fundAPIRCode,
          rows: 1,
          fq: 'SecurityTypeId:(1 OR 2 OR 3 OR 4 OR 5)',
          sort: 'UniverseSort asc'
      },
      headers: {
        'Accept': 'application/json, text/javascript, */*'
      },
      json: true
    };

    rp(options)
      .then((result) => {
        let response = result.response;
        debug(response);

        if (response.numFound >= 1) {
          // We received a resulting symbol (as expected)
          let doc = response.docs[0]
          verbose(doc);
          let symbol = doc.Symbol;
          resolve(symbol);
        }
        else {
          // We didn't revieve a resulting symbol... 
          reject("No fund symbol found for", fundAPIRCode);
        }
      })
      .catch((err) => {
        debug(err);
        reject(err);
      });
  });
}

////////////////////////////////////////////////////////////////////////////////
// 
// getDetails(fundAPIRCode)
// 
// Returns the fund details with APIRCode 'fundAPIRCode' in json format
// 

exports.getDetailsByAPIRCode = (fundAPIRCode) => {
  return new Promise((resolve, reject) => {
    // Get the Morningstar symbol for this fund
    this.getSymbol(fundAPIRCode)
      .then((fundSymbol) => {
        // Then get the details for this symbol
        let fundDetails = this.getDetailsBySymbol(fundSymbol);
        resolve(fundDetails);
      })
      .catch((err) => {
        reject(err);
      });
  });
}

////////////////////////////////////////////////////////////////////////////////
// 
// getDetails(fundSymbol)
// 
// Returns the fund details with symbol 'fundSymbol' in json format
// 

exports.getDetailsBySymbol = (fundSymbol) => {
  return new Promise((resolve, reject) => {
    // Check the fundSymbol is passed
    if (!fundSymbol) {
      reject({error: "No fundSymbol parameter"});
      return;
    }

    // Request the fund
    let fundURL = fundReportPrintBaseURL + fundSymbol;
    request(fundURL, (error, response, html) => {
      // Check for an error
      if (error) {
        reject({error: error});
        return;
      }

      // Check for a non 200 response code
      if (response.statusCode != 200) {
        reject({error: "statusCode: " + response.statusCode});
        return;
      }

      // Replace rating images with text
      html = html.replace(/<img src=\"\/Content\/images\/5starscropped.gif\" alt=\"5\" \/>/g, "5");
      html = html.replace(/<img src=\"\/Content\/images\/4starscropped.gif\" alt=\"4\" \/>/g, "4");
      html = html.replace(/<img src=\"\/Content\/images\/3starscropped.gif\" alt=\"3\" \/>/g, "3");
      html = html.replace(/<img src=\"\/Content\/images\/2starscropped.gif\" alt=\"2\" \/>/g, "2");
      html = html.replace(/<img src=\"\/Content\/images\/1starscropped.gif\" alt=\"1\" \/>/g, "1");

      // Replace instances of <br /> with " "
      html = html.replace(/<br \/>/g, " ");

      // Dump the raw html
      if (debug.enabled) {
        debug("############################################");
        debug("### Raw html");
        debug("############################################");
        debug(html);
        debug("############################################");
      }

      // Load the HTML into cheerio to parse
      let $ = cheerio.load(html);

      // Check for a non-existent fund, by checking for class=red
      // (there might be a better way, but this will do for now)
      if ($('.red').length > 0) {
        reject("Non-existent fund: " + fundSymbol);
        return;
      }

      // Init the fund object
      let fund = {
        _id:      fundSymbol,
        'Symbol': fundSymbol,
        'URL':    fundURL,
        'Name':   $('.YMWCoyFull').text()
      };

      // Iterate the fund's tables, processing them accordingly
      $('.YMWTableSmall').each((index, table) => {

        // Dump the raw html for this table
        if (debug.enabled) {
          debug("############################################");
          debug($(table).html());
        }

        // Get the table name
        let tableName = getTableName($, table);

        // Dump the table name 
        if (debug.enabled) {
          debug("############################################");
          debug("^^^ "+ tableName);
          debug("############################################");
        }

        // Check for ignored tables
        if (ignoreTables.includes(tableName)) {
          debug("Ignored...");
          return;
        } else 
          debug("Processing...");

        // Extract the table details for this section of the html, ensuring we process any table headings
        fund[tableName] = extractTable($, table, ( hasColumnHeadings.includes(tableName) ? getColumnHeadings($, table) : null) );
      });

      if (verbose.enabled) {
        verbose("############################################");
        verbose("### fund ");
        verbose("############################################");
        verbose(fund);
      }

      // Return the resulting fund details
      resolve(fund);
    });
  });
}

////////////////////////////////////////////////////////////////////////////////
// Supporing functions
////////////////////////////////////////////////////////////////////////////////

function extractTable($, table, headings) {
  let i, j, len, len2, txt, $row, $cell,
  $table = $(table),
  tmpArray = [], cellIndex = 0, result = [];

  // Iterate through the table rows
  $table.children('tbody,*').children('tr').each((rowIndex, row) => {
    // First, check for a heading and ignore it 
    if ( rowIndex > (isNull(headings) ? 0 : 1) ) {
      // Get the row
      $row = $(row);
      // Dump it
      debug("Row: " + $row.html());
      // Check the row has columns
      // let isEmpty = ;
      if ( !(($row.find('td').length === $row.find('td:empty').length) ? true : false) ) {
        // Init the row's cell array
        cellIndex = 0;
        if (!tmpArray[rowIndex]) {
          tmpArray[rowIndex] = [];
        }

        // Iterate through the row's columns
        $row.children().each(function() {
          $cell = $(this);

          // Dump the raw cell html
          debug("Cell: ", $cell.html());

          // Skip column if it's already defined
          while (tmpArray[rowIndex][cellIndex]) { cellIndex++; }

          // Get the cell value
          txt = tmpArray[rowIndex][cellIndex] || cellValue($, cellIndex, $cell);

          // Set the cell value
          //if (!isNull(txt)) {
            tmpArray[rowIndex][cellIndex] = txt;
          //}
          cellIndex++;
        });
      };
    }
  });

  for (i = 0, len = tmpArray.length; i<len; i++) {
    row = tmpArray[i];

    if (!isNull(row)) {
      txt = arraysToHash(headings, row);
      result[result.length] = txt;
    }
  }

  // Post table extraction processing for some 'special' tables... 
  switch (getTableName($, table))
  {
    case "Current Investment Style":
      result = fixCurrentInvestmentStyle(result);
      break;
    case "Quick Stats":
      result = fixQuickStats(result);
      break;
    case "Asset Allocation":
      result = fixAssetAllocation(result);
      break;
    case "Fees & Expenses":
      result = fixFeesAndExpenses(result);
      break;
    case "Trailing Year Returns":
      result = fixTrailingYearReturns(result);
      break;
  }

  // Convert the array of objects into an array of a single object
  result = convertToSingleObject(result);

  if (debug.enabled) {
    debug("### extractTable ############################################");
    debug(result);
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function getColumnHeadings($, table) {
  // The column headings are in the second row
  return rowValues($, $(table).find('tr').first().next(), true);
}

////////////////////////////////////////////////////////////////////////////////

function rowValues($, row, isHeader) {
  let result = [];
  $(row).children('td,th').each((cellIndex, cell) => {
    if ( !isHeader || (isHeader && cellIndex > 0) )
      result.push( cellValue($, cellIndex, cell, isHeader) );
  });
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function cellValue($, cellIndex, cell, isHeader) {
  // Removes everything between brackets
  let result = $(cell).text().trim().replace(/ *\([^)]*\)/g, "").replace(/%/g, "").replace(/,/g, "").replace(/--/g, "null");
  // Convert to number, if possible
  let number = Number(result);
  return number || (number===0) ? number : result === "null" ? null : result;
}

////////////////////////////////////////////////////////////////////////////////

function isNull(value) {
  return (value === undefined || value === null);
}

////////////////////////////////////////////////////////////////////////////////

function arraysToHash(headings, row) {
  let result = {}, key = row[0];

  if ( isNull(headings) ) {
    result[key] = row[1];
    return result;
  };

  let h_index = 0;
  for (let i = 1, len = row.length; i < len; i++) {
    if ( h_index < headings.length /*&& !isNull(row[i])*/ ) {
      result[ key + " " + headings[h_index] ] = row[i];
      h_index++;
    }
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function getTableName($, table) {
  // The table name is stored in the first cell of the first row
  return cellValue($, 0, $(table).find('tr').first().find('td').first(), false);
}

////////////////////////////////////////////////////////////////////////////////

function convertToSingleObject(result) {
  let temp = {};
  for (let i = 0, len=result.length; i<len; i++) {
    let keys = Object.keys(result[i]);
    for (let j = 0, len2=keys.length; j<len2; j++) {
      temp[keys[j]] = result[i][keys[j]];
    }
  }
  return temp;
}

////////////////////////////////////////////////////////////////////////////////
// Hacks to 'fix' special tables... 
// 

function fixCurrentInvestmentStyle(table) {
  let result = [];
  for (let i = 0, len = table.length; i < len; i++) {
    switch(i) {
      case 0: {
        // "as at"
        let value = Object.keys(table[i])[0].trim();
        value = value.slice(5,value.length).trim();
        result.push({'As at': value});
        break;
      }
      case 1: {
        // Ignore the second row
        break;
      }
      case 2: {
        // Strip the market cap and investment style information
        let value = Object.keys(table[i])[0].replace(/\u00a0/g, " ");
        let arr = value.split("  ");
        result.push({'Market Cap': arr[0].slice(7, arr[0].length)});
        result.push({'Investment Style': arr[1].slice(7, arr[1].length)});
        break;
      }
    };
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function fixQuickStats(table) {
  let result = [];
  for (let i = 0, len = table.length; i < len; i++) {
    switch(i) {
      case 0:
        // "as at"
        let value = Object.keys(table[i])[0].trim();
        value = value.slice(5,value.length).trim();
        result.push({'As at': value});
        break;
      default:
        // Strip the key from the value
        let row = {};
        let arr = Object.keys(table[i])[0].split("\n                        ");
        row[arr[0]] = arr[1];
        result.push(row);
    };
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function fixAssetAllocation(table) {
  let result = [];
  for (let i = 0, len = table.length; i < len; i++) {
    switch(i) {
      case 0:
        // "as at"
        let value = Object.keys(table[i])[0].trim();
        value = value.slice(5,value.length).trim();
        result.push({'As at': value});
        break;
      default:
        // Just add it to the result
        result.push(table[i]);
    };
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function fixFeesAndExpenses(table) {
  let result = [];
  for (let i = 0, len = table.length; i < len; i++) {
    let key = Object.keys(table[i])[0].trim();
    if (key === "One-Time" || key === "Annual") {
      // Drop it
    }
    else
      // Just add it to the result
      result.push(table[i]);
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////

function fixTrailingYearReturns(table) {
  let result = [];
  for (let i = 0, len = table.length; i < len; i++) {
    // Look for entries with "Rank"
    let key = isNull(Object.values(table[i])[3]) ? null : Object.keys(table[i])[3].trim();
    if (!isNull(key) && key.includes("Rank")) {
      // Strip the rank values: "x / y"
      let values = Object.values(table[i])[3].trim().split(" / ");
      // Push them back onto the resulting array
      // result.push({key: values[0]},{key: values[1]});
      let position = key + " Position";
      let total = key + " Total";
      table[i][position] = Number(values[0]);
      table[i][total] = Number(values[1]);
      result.push(table[i]);
  }
    else
      // Just add it to the result
      result.push(table[i]);
  }
  return result;
}

////////////////////////////////////////////////////////////////////////////////
