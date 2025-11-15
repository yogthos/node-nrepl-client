const { test, before, after } = require('node:test');
const assert = require('node:assert');

const nreplClient = require('../src/nrepl-client');
const nreplServer = require('../src/nrepl-server');
const async = require("async");

const serverOpts = {port: 7889, verbose: true, startTimeout: 20*1000};
const timeoutDelay = 10*1000;

let timeoutProc, client, server;

// Convert async.waterfall to Promise
function waterfall(tasks) {
    return new Promise((resolve, reject) => {
        async.waterfall(tasks, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
}


before(async () => {
    server = await waterfall([
        (next) => nreplServer.start(serverOpts, next),
        (serverState, next) => {
            server = serverState;
            client = nreplClient.connect({
                port: serverState.port,
                verbose: true
            });
            console.log("client connecting");
            client.once('connect', function() {
                console.log("client connected");
                next(null, serverState);
            });
        }
    ]);
});

after(async () => {
    // Clear any pending timeouts
    if (timeoutProc) {
        clearTimeout(timeoutProc);
        timeoutProc = null;
    }

    // Close client if it exists
    if (client) {
        await new Promise((resolve) => {
            const cleanupTimeout = setTimeout(() => {
                console.log("Client close timeout, forcing cleanup");
                resolve();
            }, 2000);

            if (client.destroyed || !client.writable) {
                clearTimeout(cleanupTimeout);
                resolve();
                return;
            }

            client.once('close', () => {
                clearTimeout(cleanupTimeout);
                resolve();
            });

            try {
                client.end();
            } catch (err) {
                console.error("Error closing client:", err);
                clearTimeout(cleanupTimeout);
                resolve();
            }
        });
    }

    // Stop server if it exists (server.stop has its own timeout)
    if (server) {
        await new Promise((resolve) => {
            // If server already exited, resolve immediately
            if (server.exited) {
                resolve();
                return;
            }

            nreplServer.stop(server, () => {
                resolve();
            });
        });
    }
});

test('simple eval', async () => {
    const messages = await new Promise((resolve, reject) => {
        timeoutProc = setTimeout(() => {
            reject(new Error('timeout'));
        }, timeoutDelay);

        client.eval('(+ 3 4)', function(err, messages) {
            if (timeoutProc) {
                clearTimeout(timeoutProc);
                timeoutProc = null;
            }
            if (err) reject(err);
            else resolve(messages);
        });
    });

    console.log("in simple eval");
    console.log(messages);

    assert.ok(messages, 'Should have messages');
    assert.equal(messages[0].value, '7');
    assert.deepEqual(messages[1].status, ['done']);
});

