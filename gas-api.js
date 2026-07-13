// ============================================================
// gas-api.js — JSONP bridge to the Fresko Apps Script backend
// ============================================================
// Polyfills google.script.run so all existing calls work from
// GitHub Pages (different origin) via CORS-free JSONP requests.
// ============================================================

var GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyCEaQizMbIS7z8VbvY3EUnafPuBFqcZx0Jbi0kKUM7LXJZ4eYw3Us3S-HvRFUGhRKy/exec';

(function () {
  var _cbIdx = 0;

  // Timeout per individual JSONP call.
  // GAS execution limit = 30s, so 35s gives enough headroom.
  var JSONP_TIMEOUT_MS = 35000;

  // MAX ROWS PER CHUNK for bulkUploadInvoices.
  // 10 rows × ~350 chars/row = ~3500 JSON chars → ~7000 encoded chars → ~7200 total URL.
  // GAS doGet safely handles URLs up to ~8000 chars. 10 rows is the sweet spot:
  //   - Fast enough per call (~2-3s in GAS, well within 30s limit)
  //   - 515 invoices ÷ 10 = ~52 sequential calls (~2-3 minutes total)
  var ROWS_PER_CHUNK = 10;

  function _rawJsonpCall(fnName, args, onSuccess, onFailure) {
    var cbName = '_gascb' + (++_cbIdx);
    var timeoutId;

    function cleanup() {
      clearTimeout(timeoutId);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      var tag = document.getElementById('_s_' + cbName);
      if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
    }

    window[cbName] = function (result) {
      cleanup();
      if (onSuccess) onSuccess(result);
    };

    timeoutId = setTimeout(function () {
      cleanup();
      if (onFailure) onFailure({ message: 'Request timed out. Please try again.' });
    }, JSONP_TIMEOUT_MS);

    var url = GAS_API_URL +
      '?callback=' + encodeURIComponent(cbName) +
      '&fn=' + encodeURIComponent(fnName) +
      '&args=' + encodeURIComponent(JSON.stringify(args || []));

    var s = document.createElement('script');
    s.id = '_s_' + cbName;
    s.src = url;
    s.onerror = function () {
      cleanup();
      if (onFailure) onFailure({ message: 'Network error while reaching the server.' });
    };
    document.head.appendChild(s);
  }

  // Splits bulkUploadInvoices into chunks of ROWS_PER_CHUNK rows each,
  // sends them sequentially, and merges results into one response object.
  function _chunkedBulkUpload(args, onSuccess, onFailure, progressCb) {
    var rows      = args[0] || [];
    var batchLabel = args[1];
    var userName  = args[2];

    // Split into fixed-size chunks
    var chunks = [];
    for (var i = 0; i < rows.length; i += ROWS_PER_CHUNK) {
      chunks.push(rows.slice(i, i + ROWS_PER_CHUNK));
    }
    if (!chunks.length) chunks.push([]);

    var merged = { success: true, rowsAdded: 0, skipped: 0, batch: batchLabel, msg: '', errors: [] };
    var chunkIdx = 0;

    function next() {
      if (chunkIdx >= chunks.length) {
        merged.msg = merged.rowsAdded + ' invoices added' +
          (merged.skipped > 0 ? ', ' + merged.skipped + ' duplicates skipped.' : '.');
        onSuccess(merged);
        return;
      }

      // Report progress if callback provided
      if (progressCb) {
        progressCb(chunkIdx, chunks.length, merged.rowsAdded);
      }

      _rawJsonpCall('bulkUploadInvoices', [chunks[chunkIdx], batchLabel, userName],
        function (res) {
          if (!res || res.success === false) {
            // On error, report what we've done so far but continue
            merged.errors.push('Chunk ' + (chunkIdx + 1) + ' failed: ' + (res && res.error || 'unknown'));
            if (merged.errors.length > 10) { onFailure(merged.errors[0]); return; }
          } else {
            merged.rowsAdded += res.rowsAdded || 0;
            merged.skipped   += res.skipped   || 0;
            if (res.errors && res.errors.length) {
              merged.errors = merged.errors.concat(res.errors).slice(0, 10);
            }
          }
          chunkIdx++;
          next();
        },
        function (err) {
          // Timeout or network error on one chunk - stop and report
          onFailure(err || { message: 'Upload failed at chunk ' + (chunkIdx + 1) + ' of ' + chunks.length });
        }
      );
    }

    next();
  }

  function _jsonpCall(fnName, args, onSuccess, onFailure, progressCb) {
    if (fnName === 'bulkUploadInvoices') {
      _chunkedBulkUpload(args, onSuccess, onFailure, progressCb);
    } else {
      _rawJsonpCall(fnName, args, onSuccess, onFailure);
    }
  }

  function createRunProxy(successHandler, failureHandler, progressHandler) {
    return new Proxy({}, {
      get: function (target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (cb) { return createRunProxy(cb, failureHandler, progressHandler); };
        }
        if (prop === 'withFailureHandler') {
          return function (cb) { return createRunProxy(successHandler, cb, progressHandler); };
        }
        if (prop === 'withUserObject') {
          return function () { return createRunProxy(successHandler, failureHandler, progressHandler); };
        }
        // Any other property = remote function name
        return function () {
          var args = Array.prototype.slice.call(arguments);
          _jsonpCall(prop, args,
            function (result) { if (successHandler) successHandler(result); },
            function (err)    { if (failureHandler) failureHandler(err); },
            progressHandler
          );
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = createRunProxy(null, null, null);
})();
