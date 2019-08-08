"use strict";

const
  { spawn } = require('child_process')
  ;

class Pyzor {

  /*
    Pyzor can use public server public.pyzor.org or self server
  */


  async check(msg) {
    let report = await this.fetchData(msg);
    return {
      report: report,
      test: this.parseTests(report)
    }
  }

  async fetchData(msg) {
    return new Promise((resolve, reject) => {
      const pyzor = spawn('pyzor', ['info']);
      pyzor.stdin.write(msg);
      let stdout = '';

      pyzor.stdout.on('data', (data) => {
        stdout += data;
      });

      pyzor.on('close', (code) => {
        /*
        The exit code is useless:
          1 if the report count is 0 or the whitelist count is > 0
          0 if the report count is > 0 and the whitelist count is 0
        */
        resolve(stdout);
      });

      pyzor.stdin.end();
    });
  }

  parseTests(data) {
    let results = {};

    let regexp = /^(.*?):\s(.*)$/gm;

    var m;
    do {
      m = regexp.exec(data);
      if (m) {
        results[m[1].trim()] = m[2].trim();
      }
    } while (m);


    return results;
  }

}

module.exports.Pyzor = Pyzor;
