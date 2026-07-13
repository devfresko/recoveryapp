// ============================================================
// gas-api.js — JSONP bridge to the Fresko Apps Script backend
// ============================================================
// This file polyfills `google.script.run` so that every existing
// `google.script.run.withSuccessHandler(...).withFailureHandler(...).xxx(args)`
// call already written in Index.html keeps working unchanged — even though
// this page is now hosted on GitHub Pages (a different origin) instead of
// inside Apps Script's own sandboxed iframe.
//
// How it works: instead of the real google.script.run RPC channel (which only
// exists when a page is served BY Apps Script), every call is translated into
// a CORS-free JSONP request: a <script src="...&callback=cbXXX"> tag pointed
// at the Apps Script doGet API (see Code.gs → API_FUNCTIONS / doGet).
//
// IMPORTANT: update GAS_API_URL below to match your deployed Apps Script
// Web App URL (Sheet menu → "Payment Follow-up" → "Show API URL (for app.js)").
// ============================================================

var GAS_API_URL = 'https://script.google.com/macros/s/AKfycbyCEaQizMbIS7z8VbvY3EUnafPuBFqcZx0Jbi0kKUM7LXJZ4eYw3Us3S-HvRFUGhRKy/exec';

(function () {
  var _cbIdx = 0;
  var JSONP_TIMEOUT_MS = 35000;
  // Keep each JSONP request's query string comfortably under safe URL-length
  // limits. Only matters for calls with big array payloads (bulk upload).
  var MAX_ARGS_JSON_LEN = 6000;

  function _rawJsonpCall(fnName, args, onSuccess, onFailure) {
    var cbName = '_gascb' + (++_cbIdx);
    var timeoutId;

    function cleanup() {
      clearTimeout(timeoutId);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      var tag = document.getElementById('_s_' + cbName);
      if (tag) tag.parentNode.removeChild(tag);
    }

    window[cbName] = function (result) {
      cleanup();
      if (onSuccess) onSuccess(result);
    };

    timeoutId = setTimeout(function () {
      cleanup();
      if (onFailure) onFailure({ message: 'Request timed out. Please check your connection and try again.' });
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

  // bulkUploadInvoices(rows, batchLabel, userName) can carry a large `rows`
  // array (CSV/XLSX import). A single JSONP GET has a practical URL-length
  // ceiling, so this splits large uploads into sequential chunked calls and
  // merges the results back into the single result shape the app expects:
  // { success, rowsAdded, skipped, batch, msg, errors }.
  // Rows per chunk — 10 rows keeps URL under 7500 chars (GAS safe limit)
  var ROWS_PER_CHUNK = 10;

  function _chunkedBulkUpload(args, onSuccess, onFailure) {
    var rows      = args[0] || [];
    var batchLabel = args[1];
    var userName  = args[2];
    var total     = rows.length;

    // Split into fixed chunks of ROWS_PER_CHUNK
    var chunks = [];
    for (var ci = 0; ci < rows.length; ci += ROWS_PER_CHUNK) {
      chunks.push(rows.slice(ci, ci + ROWS_PER_CHUNK));
    }
    if (!chunks.length) chunks.push([]);

    var merged = { success: true, rowsAdded: 0, skipped: 0, batch: batchLabel, msg: '', errors: [] };
    var i = 0;

    function next() {
      if (i >= chunks.length) {
        merged.msg = merged.rowsAdded + ' invoices added' +
          (merged.skipped > 0 ? ', ' + merged.skipped + ' skipped.' : '.');
        onSuccess(merged);
        return;
      }

      // Fire progress callback so UI can update counter
      if (typeof window.__uploadProgress === 'function') {
        window.__uploadProgress(merged.rowsAdded, total, i, chunks.length);
      }

      _rawJsonpCall('bulkUploadInvoices', [chunks[i], batchLabel, userName], function (res) {
        if (!res || res.success === false) {
          onFailure(res || { message: 'Upload failed on batch ' + (i + 1) + ' of ' + chunks.length });
          return;
        }
        merged.rowsAdded += res.rowsAdded || 0;
        merged.skipped   += res.skipped   || 0;
        if (res.errors && res.errors.length) {
          merged.errors = merged.errors.concat(res.errors).slice(0, 10);
        }
        i++;
        next();
      }, onFailure);
    }
    next();
  }

  function _jsonpCall(fnName, args, onSuccess, onFailure) {
    if (fnName === 'bulkUploadInvoices') {
      _chunkedBulkUpload(args, onSuccess, onFailure);
    } else {
      _rawJsonpCall(fnName, args, onSuccess, onFailure);
    }
  }

  function createRunProxy(successHandler, failureHandler) {
    return new Proxy({}, {
      get: function (target, prop) {
        if (prop === 'withSuccessHandler') {
          return function (cb) { return createRunProxy(cb, failureHandler); };
        }
        if (prop === 'withFailureHandler') {
          return function (cb) { return createRunProxy(successHandler, cb); };
        }
        if (prop === 'withUserObject') {
          // No-op: not needed for JSONP calls, kept only for API-shape compatibility.
          return function () { return createRunProxy(successHandler, failureHandler); };
        }
        // Any other property access is treated as the remote function name.
        return function () {
          var args = Array.prototype.slice.call(arguments);
          _jsonpCall(prop, args, function (result) {
            if (successHandler) successHandler(result);
          }, function (err) {
            if (failureHandler) failureHandler(err);
          });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  window.google.script.run = createRunProxy(null, null);
})();
