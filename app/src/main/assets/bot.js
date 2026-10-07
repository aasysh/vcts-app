/*
 * VCTS Helper — page helper injected into vctsdri.dri.gov.np pages.
 * It only uses the website's own form fields, buttons and requests,
 * the same way a person does when using the website by hand.
 */
(function () {
  if (window.__vh && window.__vh.v === 2) return;

  var vh = { v: 2, ajax: [], notes: [] };
  window.__vh = vh;

  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var pad = function (s) { s = String(s); return s.length < 2 ? '0' + s : s; };
  var norm = function (s) { return String(s == null ? '' : s).trim().replace(/\s+/g, ' ').toUpperCase(); };
  var strip = function (html) { var d = document.createElement('div'); d.innerHTML = String(html == null ? '' : html); return (d.innerText || d.textContent || '').trim(); };
  var num = function (s) { var n = Number(String(s == null ? '' : s).replace(/,/g, '')); return isFinite(n) ? n : 0; };
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
        if (window.__vh) window.__vh.ajax.push({ url: x.__vhUrl, method: x.__vhMethod, status: x.status, text: t.slice(0, 60000) });
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
  vh.post = function (url, data) {
    return new Promise(function (resolve, reject) {
      window.jQuery.ajax({
        url: url, type: 'POST', data: data,
        success: function (d) { resolve(typeof d === 'string' ? (vh.parse(d) || { raw: d }) : d); },
        error: function (x) { reject(new Error('VCTS error (HTTP ' + x.status + ')')); }
      });
    });
  };
  var progress = function (t) { try { if (window.Bot && window.Bot.progress) window.Bot.progress(String(t)); } catch (e) { } };

  /* ---------- dates (Bikram Sambat, using the website's own calendar functions) ---------- */
  var bsIso = function (o) { return o.year + '-' + pad(o.month) + '-' + pad(o.day); };
  vh.bsMinusDays = function (iso, n) {
    var NF = window.NepaliFunctions;
    var p = String(iso).split('-').map(Number);
    if (!NF || !NF.BS2AD || !NF.AD2BS) throw new Error('VCTS calendar is not available on this page.');
    var ad = NF.BS2AD({ year: p[0], month: p[1], day: p[2] });
    var d = new Date(ad.year, ad.month - 1, ad.day - n);
    return bsIso(NF.AD2BS({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }));
  };
  vh.phoneTodayBs = function () {
    var NF = window.NepaliFunctions;
    return NF && NF.GetCurrentBsDate ? bsIso(NF.GetCurrentBsDate()) : null;
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

  /* ---------- Add Consignment / Add Mid-Consignment pages ---------- */
  vh.form = function () { return document.querySelector('#BASIC_INFO') || document.querySelector('#MID_BASIC_INFO'); };
  vh.pageInfo = function () {
    var scripts = Array.prototype.slice.call(document.scripts).map(function (s) { return s.text; }).join('\n');
    var iso = function (m, d, y) { return y + '-' + pad(m) + '-' + pad(d); };
    var departFrom = null, departTo = null, docFrom = null, docTo = null, m;
    m = scripts.match(/#DEPART_DATE['"]\)\.nepaliDatePicker\(\{\s*disableBefore:\s*'(\d{1,2})\/(\d{1,2})\/(\d{4})',\s*disableAfter:\s*'(\d{1,2})\/(\d{1,2})\/(\d{4})'/);
    if (m) { departFrom = iso(m[1], m[2], m[3]); departTo = iso(m[4], m[5], m[6]); }
    var re = /(\S{0,40})\.nepaliDatePicker\(\{\s*disableBefore:\s*'(\d{1,2})\/(\d{1,2})\/(\d{4})',\s*disableAfter:\s*'(\d{1,2})\/(\d{1,2})\/(\d{4})'/g;
    while ((m = re.exec(scripts))) {
      if (m[1].indexOf('DEPART_DATE') >= 0) continue;
      var line = scripts.lastIndexOf('\n', m.index);
      if (/^\s*\/\//.test(scripts.slice(line + 1, m.index))) continue;
      docFrom = iso(m[2], m[3], m[4]); docTo = iso(m[5], m[6], m[7]);
      break;
    }
    var q = function (s) { return document.querySelector(s); };
    var mid = !!q('#MID_BASIC_INFO');
    var dist = q('#DEST_DIST');
    var today = mid ? (vh.phoneTodayBs() || departFrom) : departFrom;
    return {
      url: location.href, mid: mid, hasForm: !!vh.form(),
      today: today, departFrom: departFrom, departTo: departTo, docFrom: docFrom, docTo: docTo,
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

  /* Looks a PAN up the same way the bill row does, and returns the name(s) VCTS would fill in. */
  vh.panLookup = function (pan) {
    return new Promise(function (resolve) {
      window.jQuery.ajax({
        type: 'POST', url: location.origin + '/common/login_api', data: { pan: pan },
        success: function (resp) {
          try {
            var r = (resp && resp.status === 'local') ? resp : (typeof resp === 'string' ? JSON.parse(resp) : resp);
            var pick = function (o) { var e = String(o.NameEnglish || '').trim(); return e && e.length > 10 ? e : (String(o.NameNepali || '').trim() || e); };
            if (r && r.status && r.data && r.data.panDetails) {
              var pd = r.data.panDetails;
              var names = (pd.Businesses && pd.Businesses.length) ? pd.Businesses.map(pick) : [pick(pd)];
              resolve({ ok: true, names: names.filter(Boolean) });
            } else if (r && r.status === 'local' && r.data && r.data.length) {
              resolve({ ok: true, names: r.data.map(function (x) { return String(x.TRADE_NAME || '').trim(); }).filter(Boolean) });
            } else {
              resolve({ ok: false });
            }
          } catch (e) { resolve({ ok: false }); }
        },
        error: function (x) { resolve({ ok: false, http: x.status }); }
      });
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
    await vh.waitFor(function () { return vh.ajax.slice(n).some(function (a) { return /search_driver/.test(a.url); }); }, 20000, 'the driver lookup');
    await vh.waitFor(function () { return dn.value; }, 4000).catch(function () { });
    if (!dn.value) throw new Error('Driver ' + j.driverMobile + ' was not found in VCTS. ' + vh.takeNotes().join(' '));
    out.driver = ds.value;

    // Departure: keep what VCTS already shows, fill in only if empty.
    var dd = q('#DEPT_DIST'), dl = q('#DEPT_LOC');
    var curDept = dd.selectedIndex > 0 ? dd.options[dd.selectedIndex].text : '';
    if (j.deptDistrict && norm(curDept) !== norm(j.deptDistrict)) { curDept = vh.selectByText(dd, j.deptDistrict); await sleep(300); }
    if (!dl.value.trim() || norm(dl.value) === norm(curDept)) dl.value = j.deptLocation || curDept;
    out.from = (curDept + ', ' + dl.value).trim();

    out.to = await setDestination(j.destDistrict);

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

  var setDestination = async function (district) {
    var q = function (s) { return document.querySelector(s); };
    var ed = q('#DEST_DIST');
    var n = vh.ajax.length;
    var destText = vh.selectByText(ed, district);
    await vh.waitFor(function () { return vh.ajax.slice(n).some(function (a) { return /destinationLocationCompany/.test(a.url); }); }, 10000).catch(function () { });
    await sleep(400);
    var el = q('input[name=dest_loc]') || q('#DEST_LOC');
    if (el.tagName === 'SELECT') {
      if (el.options.length > 1) { el.selectedIndex = 1; vh.fire(el, 'change'); vh.chosen(el); }
    } else if (!el.value.trim()) {
      el.value = destText;
    }
    return (el.value && norm(el.value) !== norm(destText)) ? destText + ', ' + el.value : destText;
  };

  /* Add Mid-Consignment page: vehicle and driver come from the running consignment. */
  vh.fillMidBasic = async function (j) {
    var q = function (s) { return document.querySelector(s); };
    if (!q('#MID_BASIC_INFO')) throw new Error('The Add Mid-Consignment form did not open.');
    vh.takeNotes();
    var out = {};
    var veh = q('#MID_BASIC_INFO input[name=vehicle_number][type=text]');
    out.vehicle = veh ? veh.value : '';
    var drv = q('#DRIVER_NAME');
    out.driver = drv && drv.previousElementSibling ? drv.previousElementSibling.value : '';
    var dd = q('#DEPT_DIST'), dl = q('#DEPT_LOC');
    out.from = ((dd && dd.selectedIndex > 0 ? dd.options[dd.selectedIndex].text : '') + ', ' + (dl ? dl.value : '')).trim();
    out.to = await setDestination(j.destDistrict);
    var dt = q('#DEPART_DATE');
    dt.value = j.departDate;
    out.date = dt.value;
    var mc = q('#MULTIPLE_CASE');
    if (mc && mc.value !== '0') { mc.value = '0'; vh.fire(mc, 'change'); vh.chosen(mc); }
    var rm = q('#MID_REMARKS');
    if (rm && j.remarks) rm.value = j.remarks;
    if (!dt.value) throw new Error('Could not set the departure date.');
    out.notes = vh.takeNotes();
    return out;
  };

  vh.docRows = function () {
    return Array.prototype.slice.call(document.querySelectorAll('.docs_holder_body tr, #DOCS_TABLE tbody tr, #DOC_TABLE tbody tr'))
      .filter(function (tr, i, all) { return tr.querySelector('select[name=doc_type]') && all.indexOf(tr) === i; });
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
    await vh.waitFor(function () { return vh.ajax.slice(n).some(function (a) { return /login_api/.test(a.url); }); }, 12000).catch(function () { });
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
    var challan = String(b.docType) === '2';

    var t = f('doc_type');
    var n = vh.ajax.length;
    t.value = String(b.docType);
    vh.fire(t, 'change');
    if (challan) {
      // For a चलान VCTS swaps the destination box for a list of your own branches ("Mobile Sales").
      await vh.waitFor(function () { return vh.ajax.slice(n).some(function (a) { return /documentBranch/.test(a.url); }); }, 15000, 'the Mobile Sales list').catch(function () { });
      await vh.waitFor(function () { var d = f('destination_location'); return d && d.tagName === 'SELECT'; }, 10000, 'the Mobile Sales list');
    }
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
    var destRead = '';
    if (challan) {
      vh.selectByText(dl, b.destBranch || 'Mobile Sales');
      await vh.waitFor(function () { var p = f('place_sales'); return p && p.style.display !== 'none'; }, 5000, 'the Place of Sales box').catch(function () { });
      var ps = f('place_sales');
      if (!ps) throw new Error('The "Place of Sales" box did not appear for the चलान.');
      ps.value = b.destPlace;
      destRead = dl.value + '-' + ps.value;
    } else if (dl) {
      dl.value = b.destLocation || '';
      destRead = dl.value;
    }
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
      destination: destRead
    };
    var bad = [];
    if (read.number !== String(b.docNo)) bad.push('bill number');
    if (read.date !== b.docDate) bad.push('date');
    if (Number(read.qty) !== Number(b.qty)) bad.push('quantity');
    if (Number(read.amount) !== Number(b.amount)) bad.push('amount');
    if (f('supplier_pan').value !== b.supplierPan) bad.push('supplier PAN');
    if (f('buyer_pan').value !== b.buyerPan) bad.push('buyer PAN');
    if (!f('buyer_name').value.trim()) bad.push('buyer name');
    if (challan && (dl.value !== (b.destBranch || 'Mobile Sales') || !f('place_sales').value)) bad.push('Mobile Sales destination');
    if (!challan && !destRead) bad.push('destination');
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
    var saveRe = /(addInitialDocument|add_mid_consignment|\/add_doc)(\?|$)/;
    var seen = vh.ajax.length;
    var cidEl = function () { return document.querySelector('input[name=consignment_id]'); };
    var created = '';
    a.click();
    var errs = [];
    for (var guard = 0; guard < 3; guard++) {
      var r;
      try {
        r = await vh.waitFor(function () { return vh.ajax.slice(seen).find(function (x) { return saveRe.test(x.url); }); }, 60000, 'VCTS to save the bill');
      } catch (e) {
        return { ok: false, unknown: true, consignmentId: (cidEl() && cidEl().value) || created, error: 'VCTS did not answer after Save. Check the consignment list in VCTS before trying again.' };
      }
      seen = vh.ajax.indexOf(r) + 1;
      var j = vh.parse(r.text);
      if (!j) { errs.push('Unexpected reply from VCTS.'); break; }
      if (/add_mid_consignment/.test(r.url)) {
        if (j.status === 'success') { created = String(j.consignment || ''); continue; }   // VCTS now saves the bill itself
        errs = errs.concat(jsonErrors(j).map(function (e) { return 'Mid-Consignment: ' + e; }));
        break;
      }
      if (/addInitialDocument/.test(r.url)) {
        if (j.basic && j.basic.status === 'success') created = String(j.basic.consignment || created);
        if (j.doc && j.doc.status === 'success') { await sleep(1200); return { ok: true, consignmentId: (cidEl() && cidEl().value) || created, notes: vh.takeNotes() }; }
        if (j.basic && j.basic.status === 'error') errs = errs.concat(jsonErrors(j.basic).map(function (e) { return 'Consignment: ' + e; }));
        if (j.doc && j.doc.status === 'error') errs = errs.concat(jsonErrors(j.doc).map(function (e) { return 'Bill: ' + e; }));
        if (!errs.length && j.status === 'du_error') errs.push(strip(j.message));
        break;
      }
      // add_doc
      if (j.status === 'success') { await sleep(1200); return { ok: true, consignmentId: (cidEl() && cidEl().value) || created, notes: vh.takeNotes() }; }
      errs = errs.concat(jsonErrors(j).map(function (e) { return 'Bill: ' + e; }));
      if (!errs.length && j.message) errs.push(strip(j.message));
      break;
    }
    await sleep(800);
    if (!errs.length) errs = vh.visibleErrors(tr).concat(vh.visibleErrors(vh.form()));
    errs = errs.concat(vh.takeNotes());
    return { ok: false, consignmentId: (cidEl() && cidEl().value) || created, error: errs.join(' • ') || 'VCTS did not save the bill.' };
  };

  /* ---------- Consignment list (same requests the list page makes) ---------- */
  var DOC_TYPES = { 'बिल': '1', 'चलान': '2', 'प्रज्ञापन पत्र': '3', 'DR नोट': '4', 'Others': '5', 'CR नोट': '6', 'निकासी बिल': '7' };
  vh.listConsignments = async function (max) {
    var $ = window.jQuery;
    var t = await vh.waitFor(function () {
      if (!$.fn.dataTable || !$.fn.dataTable.isDataTable('#consignmentList')) return null;
      var tb = $('#consignmentList').DataTable();
      return tb.ajax.params() ? tb : null;
    }, 30000, 'the consignment list');
    var p = Object.assign({}, t.ajax.params());
    p.iDisplayStart = 0; p.iDisplayLength = max || 1000; p.sSearch = ''; p.sEcho = 77;
    var r = await vh.post(location.origin + '/consignment/getConsignmentList', p);
    var rows = (r && r.aaData) || [];
    return rows.map(function (x) {
      return {
        id: String(x.ID), lock: String(x.LOCK_STATUS), del: String(x.DELIVERY_STATUS), status: x.CONSIGNMENT_STATUS,
        date: x.DEPARTURE_DATE_TIME, from: String(x.DEPARTURE_LOCATION || '').trim(), to: String(x.DESTINATION_LOCATION || '').trim(),
        vehicle: x.VEHICLE_NO, driver: x.DRIVER_NAME, mobile: x.DRIVER_MOBILE_NUMBER,
        initial: String(x.INITIAL_FLAG), parent: x.INITIAL_BASIC_ID ? String(x.INITIAL_BASIC_ID) : '',
        vtype: String(x.VEHICLE_TYPE), driverId: String(x.DRIVER_ID), vehicleId: String(x.VEHICLE_ID)
      };
    });
  };

  /* Bills of one consignment. end=true gives the End Delivery view (with the ids VCTS needs). */
  vh.docList = async function (cid, end) {
    var data = { master_id: cid };
    if (!end) data.report = 'view';
    var r = await vh.post(location.origin + '/consignment/consignment_doc_list', data);
    if (!r || r.status !== 'success') throw new Error('Could not read the bills of ' + cid + '.');
    var box = document.createElement('div');
    box.innerHTML = r.data || '';
    return Array.prototype.slice.call(box.querySelectorAll('tbody tr')).map(function (tr) {
      var c = Array.prototype.map.call(tr.cells, function (td) { return (td.innerText || td.textContent || '').trim(); });
      var k = c.findIndex(function (v) { return DOC_TYPES.hasOwnProperty(v); });
      if (k < 1 || c.length < k + 13) return null;
      var box2 = tr.querySelector('input.checkIndividual');
      var link = tr.querySelector('#delivery_status_doc, a[data-id][href*="deliveryStatusUpdating"]');
      return {
        c: String(cid), st: c[k - 1], t: DOC_TYPES[c[k]], n: c[k + 2], d: c[k + 3], g: c[k + 4], u: c[k + 5],
        q: num(c[k + 6]), a: num(c[k + 7]), sp: c[k + 8], sn: c[k + 9], bp: c[k + 10], bn: c[k + 11], ds: c[k + 12],
        id: box2 ? box2.value : (link ? link.getAttribute('data-id') : '')
      };
    }).filter(Boolean);
  };

  /* Reads the list and the bills of every consignment not already known. */
  vh.syncData = async function (known, since) {
    var have = {};
    (known || []).forEach(function (id) { have[id] = 1; });
    progress('Consignment list पढ्दै…');
    var list = await vh.listConsignments(1000);
    var todo = list.filter(function (x) { return !have[x.id] && (!since || String(x.date) >= since || x.del !== '2'); });
    var docs = [], fails = [], i = 0, done = 0;
    var worker = async function () {
      while (i < todo.length) {
        var x = todo[i++];
        var ongoing = x.del === '1' || x.del === '3';
        try {
          var ds = await vh.docList(x.id, ongoing);
          docs = docs.concat(ds);
        } catch (e) { fails.push(x.id); }
        done++;
        if (done % 10 === 0 || done === todo.length) progress('बिल पढ्दै: ' + done + ' / ' + todo.length);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return { list: list, docs: docs, read: todo.map(function (x) { return x.id; }).filter(function (id) { return fails.indexOf(id) < 0; }), fails: fails };
  };

  vh.rowById = async function (id) {
    var list = await vh.listConsignments(60);
    var row = list.find(function (x) { return x.id === String(id); });
    if (!row) { list = await vh.listConsignments(1000); row = list.find(function (x) { return x.id === String(id); }); }
    if (!row) throw new Error('Consignment ' + id + ' was not found in the VCTS list.');
    return row;
  };

  // Same rule and request as the "Lock Consignment" menu item.
  vh.lock = async function (id) {
    var row = await vh.rowById(id);
    if (row.lock === '1') return { already: true, row: row };
    if (row.vtype !== '3' && (row.driverId === '0' || row.vehicleId === '1')) {
      throw new Error('VCTS says this consignment is incomplete (driver or vehicle missing). Open it in VCTS to complete it.');
    }
    var r = await vh.post(location.origin + '/consignment/lock_consignment', {
      consignmentid: row.id, driverid: row.driverId, vehicleid: row.vehicleId, vehicletype: row.vtype, mid_consignment_id: row.parent || ''
    });
    if (!r || r.status !== 'success') throw new Error('Lock Consignment failed: ' + strip((r && (r.message || r.raw)) || 'no reply'));
    return { ok: true, message: strip(r.message || '') };
  };

  // Same rule and request as the "Start Vehicle" menu item.
  vh.start = async function (id) {
    var row = await vh.rowById(id);
    if (row.del !== '0') return { already: true, row: row };
    if (row.lock !== '1') throw new Error('Start Vehicle needs the consignment to be locked first.');
    var r = await vh.post(location.origin + '/consignment/startDelivery', {
      consignmentid: row.id, driverid: row.driverId, vehicleid: row.vehicleId, initialflag: row.initial
    });
    if (!r || r.status !== 'success') throw new Error('Start Vehicle failed: ' + strip((r && (r.message || r.raw)) || 'no reply'));
    return { ok: true, message: strip(r.message || '') };
  };

  // Same requests as the End Delivery window: one bill, or several / all ticked.
  vh.endDelivery = async function (cid, which) {
    var docs = await vh.docList(cid, true);
    var open = docs.filter(function (d) { return d.id && !/delivered/i.test(d.st); });
    var pick = which === 'all' ? open : open.filter(function (d) { return (which || []).indexOf(d.id) >= 0; });
    if (!pick.length) return { ok: true, nothing: true, docs: docs.length ? docs : await vh.docList(cid, false) };
    var good = function (r) { return r && /^success/.test(String(r.status)); };
    var r;
    if (pick.length === 1 && which !== 'all') {
      r = await vh.post(location.origin + '/consignment/deliveryStatusUpdating', { id: pick[0].id, master_id: cid });
    } else {
      var data = 'master_id=' + encodeURIComponent(cid) + (pick.length === open.length ? '&checkMultiple=' : '') +
        pick.map(function (d) { return '&' + encodeURIComponent('checkIndividual[]') + '=' + encodeURIComponent(d.id); }).join('');
      r = await vh.post(location.origin + '/consignment/deliverAll', data);
    }
    if (!good(r)) throw new Error('End Delivery failed: ' + strip((r && (r.message || r.raw)) || 'no reply'));
    await sleep(800);
    var after = await vh.docList(cid, true).catch(function () { return []; });
    if (!after.length) after = await vh.docList(cid, false);
    return { ok: true, message: strip(r.message || ''), docs: after };
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
