/*
 * VCTS Helper — page helper injected into vctsdri.dri.gov.np pages.
 * It only uses the website's own form fields, buttons and requests,
 * exactly as a person would when filling the form by hand.
 */
(function () {
  if (window.__vh && window.__vh.v === 1) return;

  var vh = { v: 1, ajax: [], notes: [] };
  window.__vh = vh;

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var pad = function (s) { s = String(s); return s.length < 2 ? '0' + s : s; };
  var norm = function (s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toUpperCase(); };
  var strip = function (html) { var d = document.createElement('div'); d.innerHTML = String(html == null ? '' : html); return d.innerText.trim(); };
  vh.sleep = sleep;

  /* ---------- watch the page's own requests and messages ---------- */
  (function () {
    var P = XMLHttpRequest.prototype;
    if (P.__vhWrapped) return;
    P.__vhWrapped = true;
    var open = P.open, send = P.send;
    P.open = function (m, u) { this.__vhUrl = String(u); this.__vhMethod = m; return open.apply(this, arguments); };
    P.send = function () {
      var x = this;
      x.addEventListener('loadend', function () {
        var t = '';
        try { if (x.responseType === '' || x.responseType === 'text') t = String(x.responseText || ''); } catch (e) { }
        if (window.__vh) window.__vh.ajax.push({ url: x.__vhUrl, method: x.__vhMethod, status: x.status, text: t.slice(0, 50000) });
      });
      return send.apply(this, arguments);
    };
  })();

  window.alert = function (m) { vh.notes.push(String(m)); };
  if (window.Lobibox) {
    ['notify', 'alert'].forEach(function (k) {
      var orig = window.Lobibox[k];
      if (typeof orig !== 'function' || orig.__vh) return;
      var w = function (type, opts) {
        try { vh.notes.push(strip((opts && (opts.msg || opts.message)) || '')); } catch (e) { }
        return orig.apply(this, arguments);
      };
      w.__vh = true;
      window.Lobibox[k] = w;
    });
  }

  /* ---------- small helpers ---------- */
  vh.takeNotes = function () { var n = vh.notes.filter(Boolean); vh.notes.length = 0; return n; };
  vh.waitFor = async function (fn, timeout, what) {
    var end = Date.now() + (timeout || 15000);
    while (Date.now() < end) {
      try { var r = fn(); if (r) return r; } catch (e) { }
      await sleep(250);
    }
    throw new Error('Timed out waiting for ' + (what || 'the page'));
  };
  vh.ajaxSince = function (n, re) {
    return vh.ajax.slice(n).find(function (a) { return !re || re.test(a.url); });
  };
  vh.waitAjax = function (n, re, timeout, what) {
    return vh.waitFor(function () { return vh.ajaxSince(n, re); }, timeout, what);
  };
  vh.parse = function (t) { try { return JSON.parse(t); } catch (e) { return null; } };
  vh.fire = function (el, type) { el.dispatchEvent(new Event(type, { bubbles: true })); };
  vh.chosen = function (el) { try { if (window.jQuery) window.jQuery(el).trigger('chosen:updated'); } catch (e) { } };
  vh.selectByText = function (sel, text) {
    var want = norm(text);
    var opts = Array.prototype.slice.call(sel.options);
    var opt = opts.find(function (o) { return norm(o.text) === want; }) ||
              opts.find(function (o) { return o.value && norm(o.value) === want; });
    if (!opt) throw new Error('"' + text + '" is not in the VCTS list');
    sel.value = opt.value;
    vh.fire(sel, 'change');
    vh.chosen(sel);
    return opt.text.trim();
  };
  vh.visibleErrors = function (root) {
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll('.form-msg, .error-msg, .text-red, .help-block'))
      .filter(function (e) { return e.offsetParent !== null && e.innerText.trim(); })
      .map(function (e) { return e.innerText.trim(); });
  };
  var jsonErrors = function (part) {
    if (!part || !part.data || !part.data.length) return [];
    return part.data.map(function (d) { return strip(d.message || d.msg || ''); }).filter(Boolean);
  };

  /* ---------- login page ---------- */
  vh.login = function (user, pass) {
    var id = document.querySelector('input[name=identity]');
    var pw = document.querySelector('input[name=password]');
    if (!id || !pw) return { noForm: true, url: location.href };
    id.value = user;
    pw.value = pass;
    var form = id.form;
    setTimeout(function () {
      var btn = form.querySelector('[type=submit]');
      if (btn) btn.click(); else form.submit();
    }, 50);
    return { submitted: true };
  };
  vh.loginError = function () {
    var t = Array.prototype.slice.call(document.querySelectorAll('.alert, .text-danger, #infoMessage, .callout, .error'))
      .map(function (e) { return e.innerText.trim(); }).filter(Boolean);
    return t.join(' | ') || 'Check the user name and password in Settings.';
  };

  /* ---------- Add Consignment page ---------- */
  vh.pageInfo = function () {
    var scripts = Array.prototype.slice.call(document.scripts).map(function (s) { return s.text; }).join('\n');
    var iso = function (m, d, y) { return y + '-' + pad(m) + '-' + pad(d); };
    var today = null, docFrom = null, docTo = null, m;
    m = scripts.match(/#DEPART_DATE['"]\)\.nepaliDatePicker\(\{\s*disableBefore:\s*'(\d{1,2})\/(\d{1,2})\/(\d{4})'/);
    if (m) today = iso(m[1], m[2], m[3]);
    m = scripts.match(/function dateCounter\(\)[\s\S]*?disableBefore:\s*'(\d{1,2})\/(\d{1,2})\/(\d{4})',\s*disableAfter:\s*'(\d{1,2})\/(\d{1,2})\/(\d{4})'/);
    if (m) { docFrom = iso(m[1], m[2], m[3]); docTo = iso(m[4], m[5], m[6]); }
    var q = function (s) { return document.querySelector(s); };
    var dist = q('#DEST_DIST');
    return {
      url: location.href,
      hasForm: !!q('#BASIC_INFO'),
      today: today, docFrom: docFrom, docTo: docTo,
      company: q('#COM_NAME') ? q('#COM_NAME').value : null,
      pan: q('#PAN_NUMBER') ? q('#PAN_NUMBER').value : null,
      districts: dist ? Array.prototype.slice.call(dist.options).filter(function (o) { return o.value; }).map(function (o) { return o.text.trim(); }) : []
    };
  };

  vh.checkDriver = function (mobile) {
    return new Promise(function (resolve) {
      window.jQuery.post(location.origin + '/consignment/search_driver', { driver_mobile_number: mobile }, function (d) {
        if (typeof d === 'string') d = vh.parse(d) || { status: false, data: d };
        resolve(d && d.status ? { ok: true, name: d.data && d.data.DATA } : { ok: false, msg: strip(d && d.data) });
      }).fail(function (x) { resolve({ ok: false, msg: 'HTTP ' + x.status }); });
    });
  };

  vh.fillBasic = async function (j) {
    var q = function (s) { return document.querySelector(s); };
    if (!q('#BASIC_INFO')) throw new Error('The Add Consignment form did not open.');
    vh.takeNotes();
    var out = {};

    var radio = q('#vehicle_type_public');
    if (radio && !radio.checked) radio.click();

    var vn = q('#VEHICLE_NUMBER');
    vn.value = j.vehicle;

    // Driver: VCTS looks the driver up by mobile number.
    var ds = q('input[name=driver_search]'), dn = q('#driver_name');
    dn.value = '';
    ds.value = j.driverMobile;
    var n = vh.ajax.length;
    vh.fire(ds, 'input');
    await vh.waitAjax(n, /search_driver/, 20000, 'the driver lookup');
    await vh.waitFor(function () { return dn.value; }, 4000).catch(function () { });
    if (!dn.value) throw new Error('Driver ' + j.driverMobile + ' was not found in VCTS. ' + vh.takeNotes().join(' '));
    out.driver = ds.value;

    // Departure: keep what VCTS already shows, fill in only if empty.
    var dd = q('#DEPT_DIST'), dl = q('#DEPT_LOC');
    var curDept = dd.selectedIndex > 0 ? dd.options[dd.selectedIndex].text : '';
    if (j.deptDistrict && norm(curDept) !== norm(j.deptDistrict)) { curDept = vh.selectByText(dd, j.deptDistrict); await sleep(300); }
    if (!dl.value.trim() || norm(dl.value) === norm(curDept)) dl.value = j.deptLocation || curDept;
    out.from = (curDept + ', ' + dl.value).trim();

    // Destination district + location.
    var ed = q('#DEST_DIST');
    n = vh.ajax.length;
    var destText = vh.selectByText(ed, j.destDistrict);
    await vh.waitAjax(n, /destinationLocationCompany/, 10000).catch(function () { });
    await sleep(400);
    var el = q('input[name=dest_loc]') || q('#DEST_LOC');
    var wantLoc = (destText + ' ' + (j.destExtra || '')).trim();
    if (el.tagName === 'SELECT') {
      if (el.options.length > 1) { el.selectedIndex = 1; vh.fire(el, 'change'); vh.chosen(el); }
    } else {
      el.value = wantLoc;
    }
    out.to = (el.value && norm(el.value) !== norm(destText)) ? destText + ', ' + el.value : destText;

    var dt = q('#DEPART_DATE');
    dt.value = j.departDate;
    out.date = dt.value;

    var mc = q('#MULTIPLE_CASE');
    if (mc) { mc.value = '0'; vh.fire(mc, 'change'); vh.chosen(mc); }
    var tr = q('#is_transport');
    if (tr) { tr.value = '0'; vh.fire(tr, 'change'); vh.chosen(tr); }
    var rm = q('#CONSIGNMENT_REMARKS');
    if (rm && j.remarks) rm.value = j.remarks;

    if (vn.value !== j.vehicle) throw new Error('VCTS did not accept the vehicle number.');
    if (!dt.value) throw new Error('Could not set the departure date.');
    out.vehicle = vn.value;
    out.notes = vh.takeNotes();
    return out;
  };

  vh.docRows = function () {
    return Array.prototype.slice.call(document.querySelectorAll('.docs_holder_body tr'))
      .filter(function (tr) { return tr.querySelector('select[name=doc_type]'); });
  };
  vh.lastRow = function () { var r = vh.docRows(); return r[r.length - 1]; };

  vh.addDocRow = async function () {
    var before = vh.docRows().length;
    var btn = document.querySelector('#ADD_DOC');
    if (!btn) throw new Error('The "+" button for bills was not found.');
    vh.takeNotes();
    btn.click();
    try {
      await vh.waitFor(function () { return vh.docRows().length > before; }, 20000, 'a new bill row');
    } catch (e) {
      throw new Error('Could not add a bill row. ' + vh.takeNotes().join(' '));
    }
    await sleep(600);
    return { rows: vh.docRows().length };
  };

  vh.setPan = async function (panEl, nameEl, pan, name) {
    if (!panEl || !nameEl) return;
    if (panEl.value === pan && nameEl.value.trim()) return;
    panEl.value = pan;
    nameEl.value = '';
    var n = vh.ajax.length;
    vh.fire(panEl, 'input');
    await vh.waitAjax(n, /login_api/, 12000).catch(function () { });
    await sleep(800);
    try { if (window.jQuery) window.jQuery(panEl).autocomplete('dispose'); } catch (e) { }
    Array.prototype.slice.call(document.querySelectorAll('.autocomplete-suggestions'))
      .forEach(function (e) { e.style.display = 'none'; });
    if (panEl.value !== pan) panEl.value = pan;
    if (!nameEl.value.trim()) nameEl.value = name;
  };

  vh.fillDoc = async function (b) {
    var tr = vh.lastRow();
    if (!tr) throw new Error('The bill row was not found.');
    vh.takeNotes();
    var f = function (name) { return tr.querySelector('[name=' + name + ']'); };

    var t = f('doc_type');
    t.value = String(b.docType);
    vh.fire(t, 'change');
    await sleep(500);
    if (t.value !== String(b.docType)) throw new Error('Could not choose the document type.');

    f('doc_no').value = String(b.docNo);
    var d = f('doc_date');
    d.value = b.docDate;
    f('item_name').value = b.goods;
    var u = f('unit_type');
    vh.selectByText(u, b.unitType);
    f('unit').value = String(b.qty);
    f('total_amount').value = String(b.amount);

    await vh.setPan(f('supplier_pan'), f('supplier_name'), b.supplierPan, b.supplierName);
    await vh.setPan(f('buyer_pan'), f('buyer_name'), b.buyerPan, b.buyerName);

    var dl = f('destination_location');
    if (dl) dl.value = b.destLocation || '';
    var rm = f('remarks');
    if (rm) rm.value = b.remarks || '';

    var read = {
      type: t.options[t.selectedIndex].text.trim(),
      number: f('doc_no').value,
      date: d.value,
      goods: f('item_name').value,
      unit: u.value,
      qty: f('unit').value,
      amount: f('total_amount').value,
      supplier: (f('supplier_pan').value + ' ' + f('supplier_name').value).trim(),
      buyer: (f('buyer_pan').value + ' ' + f('buyer_name').value).trim(),
      destination: dl ? dl.value : ''
    };
    var bad = [];
    if (read.number !== String(b.docNo)) bad.push('bill number');
    if (read.date !== b.docDate) bad.push('date');
    if (Number(read.qty) !== Number(b.qty)) bad.push('quantity');
    if (Number(read.amount) !== Number(b.amount)) bad.push('amount');
    if (f('supplier_pan').value !== b.supplierPan) bad.push('supplier PAN');
    if (f('buyer_pan').value !== b.buyerPan) bad.push('buyer PAN');
    if (!f('buyer_name').value.trim()) bad.push('buyer name');
    if (bad.length) throw new Error('VCTS did not take: ' + bad.join(', ') + '. Nothing was saved.');
    read.notes = vh.takeNotes();
    return read;
  };

  // Clicks the row's own Save button and reports exactly what VCTS answered.
  vh.saveDoc = async function () {
    var tr = vh.lastRow();
    var a = tr && tr.querySelector('a.initial_save, a.add_doc, .initial_save, .add_doc');
    if (!a) return { ok: false, error: 'The Save button of the bill row was not found. Nothing was saved.' };
    vh.takeNotes();
    var n = vh.ajax.length;
    var skip = /login_api|supplier_branch|pradeshList|search_driver|destinationLocation|get_doc_view/;
    a.click();
    var r;
    try {
      r = await vh.waitFor(function () { return vh.ajax.slice(n).find(function (x) { return !skip.test(x.url); }); }, 60000, 'VCTS to save the bill');
    } catch (e) {
      return { ok: false, unknown: true, error: 'VCTS did not answer after Save. Check the consignment list in VCTS before trying again.' };
    }
    await sleep(1500);
    var j = vh.parse(r.text);
    var cidEl = document.querySelector('input[name=consignment_id]');
    var cid = (cidEl && cidEl.value) || (j && j.basic && j.basic.consignment) || '';
    var ok = !!j && ((j.doc && j.doc.status === 'success') || (!j.doc && !j.basic && j.status === 'success'));
    if (ok) return { ok: true, consignmentId: String(cid), notes: vh.takeNotes() };

    var errs = [];
    if (j && j.basic && j.basic.status === 'error') errs = errs.concat(jsonErrors(j.basic).map(function (e) { return 'Consignment: ' + e; }));
    if (j && j.doc && j.doc.status === 'error') errs = errs.concat(jsonErrors(j.doc).map(function (e) { return 'Bill: ' + e; }));
    if (j && !j.doc && !j.basic && j.status === 'error') errs = errs.concat(jsonErrors(j));
    if (!errs.length) errs = vh.visibleErrors(tr).concat(vh.visibleErrors(document.querySelector('#BASIC_INFO')));
    errs = errs.concat(vh.takeNotes());
    if (!j) errs.push('Unexpected reply from VCTS.');
    return { ok: false, consignmentId: String(cid), error: errs.join(' • ') || 'VCTS did not save the bill.' };
  };

  /* ---------- Consignment list page ---------- */
  var attrs = function (a, names) {
    var o = {};
    names.forEach(function (k) { o[k] = a.getAttribute('data-' + k) || ''; });
    return o;
  };
  var cellIs = function (tr, re) {
    return Array.prototype.slice.call(tr.cells).some(function (c) { return re.test(c.innerText.trim()); });
  };
  vh.post = function (url, data) {
    return new Promise(function (resolve, reject) {
      window.jQuery.ajax({
        url: url, type: 'POST', data: data,
        success: function (d) { resolve(typeof d === 'string' ? (vh.parse(d) || { raw: d }) : d); },
        error: function (x) { reject(new Error('HTTP ' + x.status)); }
      });
    });
  };
  vh.findRow = async function (id) {
    await vh.waitFor(function () {
      var b = document.querySelector('table tbody');
      return b && b.querySelector('td') && !/Loading|Processing/i.test(b.innerText);
    }, 30000, 'the consignment list');
    var find = function () {
      return Array.prototype.slice.call(document.querySelectorAll('table tbody tr'))
        .find(function (tr) { return tr.innerText.indexOf(id) > -1; });
    };
    var tr = find();
    if (!tr) {
      try {
        var $ = window.jQuery;
        $('table').each(function () {
          if ($.fn.dataTable && $.fn.dataTable.isDataTable(this)) $(this).DataTable().search(id).draw();
        });
      } catch (e) { }
      tr = await vh.waitFor(find, 20000, 'consignment ' + id + ' in the list');
    }
    return tr;
  };
  vh.lock = async function (id) {
    var tr = await vh.findRow(id);
    var a = tr.querySelector('a[href*="lock_consignment"]');
    if (!a) {
      if (cellIs(tr, /^Locked$/i)) return { already: true };
      throw new Error('"Lock Consignment" is not available for ' + id + '.');
    }
    var d = attrs(a, ['consignmentid', 'driverid', 'vehicleid', 'vehicletype', 'mid_consignment_id']);
    if (d.vehicletype !== '3' && (d.driverid === '0' || d.vehicleid === '1')) {
      throw new Error('VCTS says this consignment is incomplete (driver or vehicle missing). Open it in VCTS to complete it.');
    }
    var r = await vh.post(a.href, d);
    if (!r || r.status !== 'success') throw new Error('Lock failed: ' + strip((r && (r.message || r.raw)) || 'no reply'));
    return { ok: true, message: strip(r.message || '') };
  };
  vh.start = async function (id) {
    var tr = await vh.findRow(id);
    if (cellIs(tr, /^(Ongoing|Delivered)$/i)) return { already: true };
    var a = tr.querySelector('a[href*="startDelivery"]');
    if (!a) throw new Error('"Start Vehicle" is not available for ' + id + ' (is it locked?).');
    var d = attrs(a, ['consignmentid', 'driverid', 'vehicleid', 'initialflag']);
    var r = await vh.post(a.href, d);
    if (!r || r.status !== 'success') throw new Error('Start Vehicle failed: ' + strip((r && (r.message || r.raw)) || 'no reply'));
    return { ok: true, message: strip(r.message || '') };
  };

  /* ---------- Print page ---------- */
  vh.preparePrint = function () {
    var s = document.createElement('style');
    s.textContent = '.main-header,.main-sidebar,.main-footer,.control-sidebar,.box-header,.content-header,.navbar,.no-print{display:none!important}' +
      '.content-wrapper{margin-left:0!important;padding-top:0!important;min-height:0!important}body{background:#fff!important}';
    document.head.appendChild(s);
    return { ok: document.body.innerText.indexOf('Consignment ID') > -1 };
  };
  vh.waitImages = function () {
    return vh.waitFor(function () {
      return Array.prototype.slice.call(document.images).every(function (i) { return i.complete; });
    }, 15000, 'images').then(function () { return true; }, function () { return true; });
  };
})();
