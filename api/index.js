"use strict";


const
  assert = require('assert'),
  Registry = new (require('./lib/Registry').Registry),
  config = {
    incomingMailPort: process.env.PORT_API,
    incomingMailMaxSize: process.env.API_INCOMING_MAIL_MAX_SIZE,
    maxMailCount: parseInt(process.env.API_MAX_MAIL_COUNT),
    spamassassin: {
      port: process.env.PORT_SPAMASSASSIN,
      maxSize: process.env.SPAMASSASSIN_MAX_MSG_SIZE
    },
    mongo: {
      uri: process.env.MONGO_URI,
      db: process.env.MONGO_DB,
    }
  }
  ;

class Api {
  constructor() {
    return new Promise((appResolve, appReject) => {

      const init = async () => {
        await this.connectMongo();
        await this.initMongo();

        Registry.register('mongo', this.mongo);
        Registry.register('spamassassin', new (require('./lib/Spamassassin').Spamassassin)(config.spamassassin));

        appResolve(this);
        setInterval(this.clearMongo, 3600 * 1000);
        this.clearMongo();
      }

      init().catch(err => {
        console.log(err);
        appReject(err);
      });

    });
  }

  connectMongo() {
    const
      mongodb = require('mongodb'),
      MongoClient = mongodb.MongoClient
      ;

    return new Promise((resolve, reject) => {
      MongoClient.connect(config.mongo.uri, { useNewUrlParser: true }, (err, db) => {
        assert.equal(null, err);
        this.mongo = db.db(config.mongo.db);
        resolve();
      });
    });
  }

  initMongo() {
    return new Promise((resolve, reject) => {
      this.mongo.createCollection("mails").then(() => {
        resolve();
      }).catch(err => {
        reject(err);
      });
    });
  }

  async clearMongo() {
    try {
      let collectionMails = Registry.get('mongo').collection('mails');
      let stats = await collectionMails.stats();
      console.log(`Mails count: ${stats['count']}`);
      let removeBorder = stats['count'] - config.maxMailCount;
      if(removeBorder <= 0) return;
      // `sort({_id: 1})` is not used because sometimes _id order may be random
      let borderDoc = await collectionMails.find().sort({created: 1}).skip(removeBorder).limit(1).next();

      collectionMails.deleteMany({created: { $lt: new Date(borderDoc.created) }});
      console.log(`Removed ${removeBorder} mails`);
    } catch (err) {
      console.log(err);
    }
  }

  run() {
    const
      express = require('express'),
      bodyParser = require('body-parser'),
      api = express(),
      { Mailtester } = require('./lib/Mailtester')
      ;

    api.use(bodyParser.text({limit: config.incomingMailMaxSize, type: 'text/plain'}));

    api.use(function(req, res, next) {
      res.setHeader('Content-Type', 'application/json');
      next();
    });

    api.get('/healthcheck', async (req, res) => {
      res.send(JSON.stringify({result: "ok"}));
    });

    /*
      This endpoint serve web and MTA incoming messages

      API must return
      * 201 Created - all is fine
      * 400 Bad Request - wrong field "To:"
      * 500 Internal Server Error - for server errors

      # MTA will be retry delivery via API for 5xx HTTP codes and "Connection refused" (exit code 7)
    */
    api.post('/checkmail', async (req, res) => {
      // res.status(400).send('Temp error'); return;        // Error test case
      // res.status(503).send('Server error'); return;      // Error test case
      // res.send(JSON.stringify({result: "ok"})); return;  // Ok short case

      let mailtester = new Mailtester();
      await mailtester.makeFromRaw(req.body);

      try {
        try {
          // Save mail and report about this
          await mailtester.saveRaw();
          res.send(JSON.stringify({result: "ok"}));
        } catch (err) {
          // ... or report about wrong ObjectId in To: field
          if(mailtester.ObjectId === null) {
            console.log('3');
            res.status(400).send(JSON.stringify({result: "fail", reason: "Wrong fied \"To:\" - use MongoDB ObjectId as user name"}));
            return;
          } else {
            // ... or report about server fault, and MTA will retry
            throw err;
          }
        }

        try {
          await mailtester.checkAll();
        } catch (err) {
          console.log(err);
        }
      } catch (err) {
        console.log(err);
        res.status(500).send(JSON.stringify({result: "fail", reason: err.message}));
      }
    });

    api.use(function(req, res, next) {
      res.status(404).send('Wrong API URI');
    });

    api.use(function(err, req, res, next) {
      console.log(err);
      if (req.xhr) {
        res.status(500).send({ error: err.message ? err.message : "Internal Server Error" });
      } else {
        next(err);
      }
    });

    api.listen(config.incomingMailPort);
    console.log(`API is listening port ${config.incomingMailPort}`);
  }
}

var api = new Api();
api.then((api) => {
  api.run();
});
