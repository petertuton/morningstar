////////////////////////////////////////////////////////////////////////////////
// Imports

const dotenv = require('dotenv').config({silent: true}),
  Cloudant = require('cloudant'),
  cloudant = Cloudant({url: process.env.CLOUDANT_URL, plugin:'retry', retryAttempts:100})

const LineByLineReader = require('line-by-line')
const path = require('path');
const fund = require("./fund");

// Debugging
const verbose = require('debug')('morningstar:verbose');
const debug = require('debug')('morningstar:debug');

////////////////////////////////////////////////////////////////////////////////
// Constants

const fundsFile = path.join(__dirname, "funds.txt");
const fundsFileReader = new LineByLineReader(fundsFile);

////////////////////////////////////////////////////////////////////////////////

// Init the list of funds
var funds = [];

////////////////////////////////////////////////////////////////////////////////
// 
// fundsFileReader event handlers

fundsFileReader.on('error', function (err) {
	// 'err' contains error object
});

fundsFileReader.on('line', function (line) {
  // 'line' contains the current line without the trailing newline character.
  funds.push(line);
});

fundsFileReader.on('end', function () {
  // All lines are read, file is closed now.
  main(); 
});

////////////////////////////////////////////////////////////////////////////////

async function main() {
  try {
    // Remove any existing database named "funds"
    // verbose("Destroying existing funds database...");
    // await cloudant.db.destroy('funds');

    // // Create a new "funds" database
    // verbose("Creating funds database...");
    // await cloudant.db.create('funds');

    // Use the funds database
    verbose("Using funds database...");
    let funddb = await cloudant.db.use('funds');

    // Request and insert the funds
    verbose("Requesting and inserting funds...");
    for (let i = 0, len = funds.length; i<len; i++) {
      debug("Requesting fund details for fund:",funds[i]);
      // Get the fund by it's APIR code
      let fundDetails = await fund.getDetailsByAPIRCode(funds[i]); 
      // Insert the fund into Cloudant
      await insertFundDetails(funddb, fundDetails);
      // Wait to ensure we don't overload Cloudant
      await Pause(100);
    }

  } catch (err) {
    console.log(err);
  }
}

////////////////////////////////////////////////////////////////////////////////
// 
// Supporting functions
// 
////////////////////////////////////////////////////////////////////////////////
// 
// Rate limiter - required for Lite tier of Cloudant
// 

function Pause(milliseconds) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve('resolved');
    },milliseconds);
  });
}

////////////////////////////////////////////////////////////////////////////////

function insertFundDetails(funddb, fundDetails) {
  return new Promise(function(resolve, reject) {
    funddb.insert(fundDetails, (err, body, header) => {
      if (err) {
        reject('[funddb.insert:' + fundDetails._id + '] ' + err.message);
        return;
      }
      verbose('Inserted the fund: ' + fundDetails._id);
      debug(body);
      resolve(true);
    });
  })
}

////////////////////////////////////////////////////////////////////////////////
