'use strict';

      // --- PERFORMANCE UTILS ---
      function _debounce(fn, ms) {
        let t;
        return function() { clearTimeout(t); t = setTimeout(() => fn.apply(this, arguments), ms); };
      }
      // RequestAnimationFrame wrapper for smooth renders
      function _raf(fn) { (window.requestAnimationFrame || setTimeout)(fn, 0); }

      // --- LOGIN LOGIC ---
      let _user = null;
      function toggleEye(btn) {
        const inp = document.getElementById('f-pass');
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        btn.querySelector('i').className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
      }
      function showErr(msg) {
        const b = document.getElementById('eb');
        document.getElementById('et').textContent = msg;
        b.classList.remove('on');
        void b.offsetWidth;
        b.classList.add('on');
      }
      function clearErr() { document.getElementById('eb').classList.remove('on'); }
      function setBusy(on) {
        const b = document.getElementById('btn');
        b.classList.toggle('busy', on);
        b.disabled = on;
      }
      function doLogin() {
        clearErr();
        const email = document.getElementById('f-email').value.trim().toLowerCase();
        const pass = document.getElementById('f-pass').value.trim();
        if (!email) { showErr('Please enter your email address.'); return; }
        if (!pass) { showErr('Please enter your password.'); return; }
        setBusy(true);
        google.script.run
          .withSuccessHandler(function (res) {
            setBusy(false);
            if (res.success) {
              _user = res.user;
              window.__ISE_USER = res.user; // Set global user
              showWelcome(res.user);
            } else {
              showErr(res.error || 'Invalid credentials.');
            }
          })
          .withFailureHandler(function (err) {
            setBusy(false);
            showErr('Connection error. Please try again.');
          })
          .loginUser({ email: email, password: pass });
      }
      function showWelcome(u) {
        const parts = (u.name || 'IS').trim().split(/\s+/);
        const initials = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || 'IS').slice(0, 2);
        document.getElementById('wav').textContent = initials.toUpperCase();
        document.getElementById('wn').textContent = u.name;
        document.getElementById('wd').textContent = (u.dept || '') + ' DEPARTMENT';
        document.getElementById('we').textContent = u.email;
        document.getElementById('form-area').style.display = 'none';
        document.getElementById('wc').style.display = 'block';
      }
      function enterApp() {
        if (!_user) return;
        USER = _user;
        URL_NAME = _user.name || '';
        URL_DEPT = _user.dept || '';
        URL_ROLE = _user.role || '';
        window.__ISE_USER = _user;
        try { localStorage.setItem('fresko_user', JSON.stringify(_user)); } catch(e) {}
        document.getElementById('login-wrapper').style.display = 'none';
        document.getElementById('app-wrapper').style.display = 'flex';
        _setUserUI();
        _applyPermissions();
        google.script.run
          .withSuccessHandler(_onDataLoaded)
          .withFailureHandler(_onFail)
          .getAllData(URL_NAME);
      }


      (function(){try{var s=localStorage.getItem('fresko_user');if(s){var u=JSON.parse(s);if(u&&u.name)_user=u;}}catch(e){}})();

      let DB = { parties: [], invoices: [], payments: [], followups: [], config: {}, stats: {}, userInfo: {}, purchases: [], purchaseVendors: [] };
      let USER = {};          // logged-in user
      let _loadedOnce = false;
      let _lastUpdate = '0';
      let _activeView = 'dashboard';
      let _sbCollapsed = true; // start collapsed -- matches screenshot (icon-only mode)
      let _charts = {};       // Chart.js instances
      let _fuTab = 'today';   // dashboard followup tab

      const PER = 25;
      let _pState = { parties: 1, invoices: 1, payments: 1, followups: 1, promises: 1, escalations: 1, shortpay: 1, latepay: 1, discountTBG: 1, writeoffs: 1 };
      let _filtered = { parties: [], invoices: [], payments: [], followups: [] };
      let _filters = { party: 'ALL', inv: 'ALL', fu: 'ALL', promise: 'ALL' };

      // User info injected by getIndexHtml() server-side OR from URL params
      // Works for both Google Sites embed (document.write) and direct URL access
      const _urlParams = new URLSearchParams(window.location.search);
      let URL_NAME = (window.__ISE_USER && window.__ISE_USER.name) || decodeURIComponent(_urlParams.get('Name') || '');
      let URL_DEPT = (window.__ISE_USER && window.__ISE_USER.dept) || decodeURIComponent(_urlParams.get('Dept') || '');
      let URL_ROLE = (window.__ISE_USER && window.__ISE_USER.role) || decodeURIComponent(_urlParams.get('Role') || '');

      (function applyUser() {
        if (_user && _user.name) {
          USER = _user; URL_NAME = _user.name||''; URL_DEPT = _user.dept||''; URL_ROLE = _user.role||'';
          window.__ISE_USER = _user;
          var lw=document.getElementById('login-wrapper'); var aw=document.getElementById('app-wrapper');
          if(lw)lw.style.display='none'; if(aw)aw.style.display='flex'; return;
        }
        if (!URL_NAME) return;
        USER = { name: URL_NAME, dept: URL_DEPT, role: URL_ROLE };
        _setUserUI(); _applyPermissions();
      })();

      window.onload = function () {
        var _fyEl = document.getElementById('footer-year'); if(_fyEl) _fyEl.textContent = new Date().getFullYear();
        document.getElementById('dash-date').textContent =
          new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        _setDefaultDates();
        document.addEventListener('click', e => {
          if (!e.target.closest('.search-wrap') && !e.target.closest('.ac-drop'))
            document.querySelectorAll('.ac-drop').forEach(d => d.classList.remove('show'));
        });
        // ESC key closes any open modal
        document.addEventListener('keydown', e => {
          if (e.key === 'Escape') {
            closeRPModal();
            closeFUModal();
            closePartyModal();
          }
        });
        if (_user && _user.name) {
          _setUserUI(); _applyPermissions();
          google.script.run.withSuccessHandler(_onDataLoaded)
            .withFailureHandler(function(){try{localStorage.removeItem('fresko_user');}catch(e){}_user=null;location.reload();})
            .getAllData(_user.name);
        }
      };

      function _onDataLoaded(data) {
        if (!data || !data.success) { _onFail({ message: data ? data.error : 'Load failed' }); return; }
        DB = data;
        document.getElementById('loader').style.display = 'none';

        if (data.userInfo && data.userInfo.foundInDB) {
          USER = Object.assign(USER, data.userInfo);
          if (!URL_NAME && USER.name) URL_NAME = USER.name;
          _setUserUI();
        }

        _applyPermissions();
        _populateFilters();
        _buildAllPartySS();   // build searchable selects with latest party data
        _updateBadges();

        if (!_loadedOnce) {
          _loadedOnce = true;
          nav('dashboard');
          setInterval(_silentRefresh, 30000);
        } else {
          _reRenderCurrent();
        }
      }

      function _onFail(err) {
        document.getElementById('loader').innerHTML =
          `<div style="text-align:center;padding:24px">
      <i class="fas fa-exclamation-circle" style="font-size:32px;color:var(--red);margin-bottom:12px;display:block"></i>
      <div style="font-weight:700;color:var(--red);margin-bottom:8px">Failed to load data</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:16px">${err.message || 'Unknown error'}</div>
      <button class="btn btn-primary" onclick="location.reload()">Reload</button>
    </div>`;
      }

      function _setUserUI() {
        const name = USER.name || 'IS';
        const initials = name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
        const photoURL = USER.profileImageURL || '';

        const avatarEl = document.getElementById('sb-avatar');
        if (avatarEl) {
          if (photoURL) {
            avatarEl.innerHTML = '';
            avatarEl.style.background = 'none';
            avatarEl.style.padding = '0';
            avatarEl.style.overflow = 'hidden';
            const img = document.createElement('img');
            img.src = photoURL;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:50%';
            img.onerror = () => {
              avatarEl.innerHTML = initials;
              avatarEl.style.background = 'linear-gradient(135deg,#C5221F,#EA4335)';
              avatarEl.style.padding = '';
            };
            avatarEl.appendChild(img);
          } else {
            avatarEl.textContent = initials;
            avatarEl.style.background = 'linear-gradient(135deg,#C5221F,#EA4335)';
          }
        }

        const nameEl = document.getElementById('sb-name');
        if (nameEl) nameEl.textContent = name;
        const deptEl = document.getElementById('sb-dept');
        if (deptEl && !deptEl.querySelector('.sb-role-badge')) {
          deptEl.textContent = USER.dept || '';
        }
      }

      function _applyPermissions() {
        const role = (USER.role || URL_ROLE || '').toString().trim().toUpperCase();
        const isAdmin = role === 'ADMIN'; // ONLY Role=ADMIN gets admin access

        // ── Capability flags ────────────────────────────────────
        window._isAdmin          = isAdmin;
        window._canRecordPay     = true;    // both Admin and User
        window._canLogFollowup   = true;    // both
        window._canUpload        = true;    // both
        window._canViewAnalytics = isAdmin; // Admin only
        window._canViewDTBG      = isAdmin; // Admin only
        window._userRole         = role;

        // ── Sidebar: nav-admin-only items ───────────────────────
        document.querySelectorAll('.nav-admin-only').forEach(el => {
          const isDiv = el.classList.contains('sb-nav-divider') || el.classList.contains('sb-section-label');
          el.style.display = isAdmin ? (isDiv ? 'block' : 'flex') : 'none';
        });

        // ── Inline admin-only elements (edit btns, etc.) ────────
        document.querySelectorAll('.admin-only').forEach(el => {
          el.style.display = isAdmin ? '' : 'none';
        });

        // ── Always-visible nav (both roles) ────────────────────
        const alwaysVisible = [
          'nav-dashboard', 'nav-todayDue', 'nav-overdue',
          'nav-parties', 'nav-pending',
          'nav-invoices', 'nav-addInvoice', 'nav-upload',
          'nav-slab15due', 'nav-slab1due', 'nav-slabNildue',
          'nav-shortpay', 'nav-payments', 'nav-latepay', 'nav-recPayment',
          'nav-followups', 'nav-promises'
        ];
        alwaysVisible.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.style.display = 'flex';
        });

        // ── Sidebar role badge ──────────────────────────────────
        const deptEl = document.getElementById('sb-dept');
        if (deptEl) {
          const label = isAdmin ? 'Admin' : 'User';
          const color = isAdmin ? '#EA4335' : '#475569';
          const dept = (USER.dept || URL_DEPT || '').toString().trim().toUpperCase() || 'ACCOUNT';
          deptEl.innerHTML =
            `<span style="color:#475569;font-size:10px">${dept}</span>` +
            `<span class="sb-role-badge" style="background:${color};color:#fff">${label}</span>`;
        }
      }

      function _silentRefresh() {
        const uname = (USER && USER.name) || URL_NAME || '';
        if (!uname) return; // not logged in yet
        google.script.run
          .withSuccessHandler(t => {
            if (t && t > _lastUpdate) {
              _lastUpdate = t;
              google.script.run
                .withSuccessHandler(data => {
                  if (!data || !data.success) return;
                  DB = data;
                  _updateBadges();
                  _populateFilters();
                  _reRenderCurrent();
                })
                .getAllData(uname);
            }
          })
          .checkLastUpdate();
      }

      function manualRefresh() {
        const icon = document.getElementById('refresh-icon');
        if (icon) { icon.classList.add('spinning'); icon.style.pointerEvents = 'none'; }
        const uname = (USER && USER.name) || URL_NAME || '';
        google.script.run
          .withSuccessHandler(data => {
            if (icon) { icon.classList.remove('spinning'); icon.style.pointerEvents = ''; }
            if (!data || !data.success) { Swal.fire('Error', (data && data.error) || 'Refresh failed', 'error'); return; }
            // Full replace - this clears deleted rows from UI
            DB = data;
            _lastUpdate = data.lastUpdate || _lastUpdate;
            _updateBadges();
            _populateFilters();
            _buildAllPartySS();
            _reRenderCurrent();
            // Brief visual confirmation
            const tb = document.getElementById('tb-crumb');
            if (tb) { const prev = tb.textContent; tb.textContent = '✓ Refreshed'; setTimeout(() => { tb.textContent = prev; }, 1200); }
          })
          .withFailureHandler(e => {
            if (icon) { icon.classList.remove('spinning'); icon.style.pointerEvents = ''; }
            Swal.fire('Error', e.message || 'Refresh failed', 'error');
          })
          .getAllData(uname);
      }

      function _reRenderCurrent() {
        const v = _activeView;
        if (v === 'dashboard') renderDashboard();
        if (v === 'todayDue') renderTodayDue();
        if (v === 'overdue') renderOverdue();
        if (v === 'parties') renderParties();
        if (v === 'invoices') renderInvoices();
        if (v === 'pending') renderPendingSummary();
        if (v === 'slab15due') renderSlabDue('15');
        if (v === 'slab1due') renderSlabDue('1');
        if (v === 'slabNildue') renderSlabDue('Nil');
        if (v === 'shortpay') renderShortPay();
        if (v === 'latepay') renderLatePay();
        if (v === 'payments') renderPayments();
        if (v === 'followups') renderFollowups();
        if (v === 'promises') renderPromises();
        if (v === 'escalations') renderEscalations();
        if (v === 'discountTBG') { if (!window._canViewDTBG) { Swal.fire('Access Denied','Discount TBG is available for Admin only.','error'); return; } renderDiscountTBG(); }
        if (v === 'writeoffs') renderWriteOffs();
        if (v === 'reports') { if (!window._canViewAnalytics) { Swal.fire('Access Denied','Analytics is available for Admin only.','error'); return; } loadReports(); }
      }

      const VIEW_TITLES = {
        dashboard: 'Dashboard', todayDue: "Today's Due", overdue: 'Overdue',
        parties: 'Parties', addParty: 'Add Party', invoices: 'Sales Invoices',
        pending: 'Pending Invoices', addInvoice: 'New Invoice', upload: 'CSV Upload',
        slab15due: '1.5% Slab -- Due Invoices', slab1due: '1% Slab -- Due Invoices',
        slabNildue: 'Nil Slab -- Due Invoices',
        shortpay: 'Short Payments', latepay: 'Late Payments',
        payments: 'Payments', recPayment: 'Record Payment', followups: 'Follow-ups',
        promises: 'Promise Tracker', escalations: 'Escalations',
        discountTBG: 'Discount to be Given', writeoffs: 'Write-Offs', reports: 'Reports',
        purchase: 'Purchase Register', purchaseUpload: 'Upload Purchase', addPurchase: 'Add Purchase Entry', purchaseVendors: 'Purchase Vendors'
      };

      function nav(v) {
        if (window.innerWidth <= 768) document.getElementById('sb').classList.remove('mobile-show');

        document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
        const el = document.getElementById('view-' + v);
        if (el) el.classList.add('active');

        document.querySelectorAll('.sb-nav-item').forEach(n => n.classList.remove('active'));
        const nb = document.getElementById('nav-' + v);
        if (nb) nb.classList.add('active');

        document.getElementById('tb-crumb').textContent = VIEW_TITLES[v] || v;
        _activeView = v;

        if (v === 'dashboard') renderDashboard();
        if (v === 'todayDue') renderTodayDue();
        if (v === 'overdue') renderOverdue();
        if (v === 'parties') { _populateFilters(); renderParties(); }
        if (v === 'invoices') { _populateFilters(); renderInvoices(); }
        if (v === 'pending') renderPendingSummary();
        if (v === 'slab15due') renderSlabDue('15');
        if (v === 'slab1due') renderSlabDue('1');
        if (v === 'slabNildue') renderSlabDue('Nil');
        if (v === 'shortpay') renderShortPay();
        if (v === 'latepay') renderLatePay();
        if (v === 'payments') renderPayments();
        if (v === 'followups') renderFollowups();
        if (v === 'promises') renderPromises();
        if (v === 'escalations') renderEscalations();
        if (v === 'discountTBG') { if (!window._canViewDTBG) { Swal.fire('Access Denied','Discount TBG is available for Admin only.','error'); return; } renderDiscountTBG(); }
        if (v === 'writeoffs') renderWriteOffs();
        if (v === 'reports') { if (!window._canViewAnalytics) { Swal.fire('Access Denied','Analytics is available for Admin only.','error'); return; } loadReports(); }
        if (v === 'addInvoice') { _setDefaultDates(); resetInvoiceForm(); _buildAllPartySS(); }
        if (v === 'recPayment') { _setDefaultDates(); resetPaymentForm(); _buildAllPartySS(); }
        if (v === 'addParty') resetPartyForm();
        if (v === 'purchase') renderPurchase();
        if (v === 'purchaseVendors') renderPurchaseVendors();
        if (v === 'addPurchase') { resetPurForm(); _buildPurVendorSS(); }
        if (v === 'purchaseUpload') clearPurUpload();
      }

      function toggleSB() {
        const sb = document.getElementById('sb');
        if (window.innerWidth <= 768) {
          sb.classList.toggle('mobile-show');
          return;
        }
        _sbCollapsed = !_sbCollapsed;
        sb.classList.toggle('collapsed', _sbCollapsed);
        const full = document.getElementById('sb-logo-full');
        const mini = document.getElementById('sb-logo-mini');
        const chev = document.getElementById('sb-chev');
        if (full) full.style.display = _sbCollapsed ? 'none' : 'flex';
        if (mini) mini.style.display = _sbCollapsed ? 'flex' : 'none';
        if (chev) {
          chev.className = _sbCollapsed ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
        }
      }

      (function initLogo() {
        const full = document.getElementById('sb-logo-full');
        const mini = document.getElementById('sb-logo-mini');
        if (full) full.style.display = 'none';
        if (mini) mini.style.display = 'flex';
      })();

      const INR = n => n == null ? '--' : '₹' + Math.round(n).toLocaleString('en-IN');
      const txt = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
      const escQ = s => (s || '').replace(/'/g, "\\'");
      const escHTML = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

      function pending(inv) {
        // Bill Value is what customer owes (GST inclusive)
        const payable = inv.billValue || inv.netAmount || 0;
        const discAlreadyGiven = _discForInvoice(inv.invoiceNo);
        return Math.max(0, payable - (inv.paidAmount || 0) - (inv.writeOff || 0) - discAlreadyGiven);
      }
      function isPaid(inv) { return pending(inv) <= 0 || inv.status === 'Written-Off' || inv.status === 'Paid'; }

      function parseIST(str) {
        if (!str) return null;
        const s = str.toString().split(' ')[0].split('/');
        if (s.length < 3) return null;
        return new Date(+s[2], +s[1] - 1, +s[0]);
      }

      function todayStr() {
        const d = new Date();
        return String(d.getDate()).padStart(2, '0') + '/' +
          String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
      }
      function isToday(dtStr) {
        if (!dtStr) return false;
        const raw = dtStr.toString().split(' ')[0].trim();
        // Handle ISO format: "2025-05-03" -> convert to dd/MM/yyyy
        if (raw.includes('-')) {
          const p = raw.split('-');
          if (p.length === 3) return (p[2].padStart(2,'0') + '/' + p[1].padStart(2,'0') + '/' + p[0]) === todayStr();
        }
        return raw === todayStr();
      }

      function daysOD(inv) {
        const d = parseIST(inv.dueDate);
        if (!d) return 0;
        const t = new Date(); t.setHours(0, 0, 0, 0);
        return Math.floor((t - d) / 86400000);
      }

      function slabBadge(s) {
        if (s === '1.5') return `<span class="slab-15">1.5%</span>`;
        if (s === '1') return `<span class="slab-1">1%</span>`;
        return `<span class="slab-0">Nil</span>`;
      }

      function statusBadge(s) {
        const m = {
          'Paid': 'badge-paid', 'Pending': 'badge-pending', 'PartPaid': 'badge-partpaid',
          'Overdue': 'badge-overdue', 'Disputed': 'badge-disputed', 'Cancelled': 'badge-cancelled'
        };
        return `<span class="badge ${m[s] || 'badge-pending'}">${s || 'Pending'}</span>`;
      }

      function priorityBadge(p) {
        const m = { 'High': 'badge-high', 'Medium': 'badge-medium', 'Low': 'badge-low' };
        return `<span class="badge ${m[p] || 'badge-medium'}">${p || 'Medium'}</span>`;
      }

      function ageBadge(days) {
        if (days <= 7) return `<span class="overdue-age age-1">${days}d</span>`;
        if (days <= 15) return `<span class="overdue-age age-2">${days}d</span>`;
        if (days <= 30) return `<span class="overdue-age age-3">${days}d</span>`;
        if (days <= 60) return `<span class="overdue-age age-4">${days}d</span>`;
        return `<span class="overdue-age age-5">${days}d</span>`;
      }

      function modeIcon(m) {
        const ic = { 'Phone Call': 'fa-phone', 'WhatsApp': 'fa-comment-dots', 'In Person': 'fa-user-check', 'Email': 'fa-envelope' };
        return ic[m] || 'fa-comment';
      }

      function modeBg(m) {
        const bg = { 'Phone Call': '#E8F0FE;color:#1967D2', 'WhatsApp': '#E6F4EA;color:#137333', 'In Person': '#FCE8E6;color:#EA4335', 'Email': '#F8FAFC;color:#475569' };
        return bg[m] || '#F8FAFC;color:#475569';
      }

      function _setDefaultDates() {
        const today = new Date().toISOString().split('T')[0];
        const now = new Date().toISOString().slice(0, 16);
        ['ai-invdate', 'rp-date'].forEach(id => { const el = document.getElementById(id); if (el) el.value = today; });
        const fdt = document.getElementById('fu-dt'); if (fdt) fdt.value = now;
      }

      function _updateBadges() {
        if (!DB.stats) return;
        txt('badge-td', DB.stats.dueTodayCount || 0);
        txt('badge-od', DB.stats.overdueCount || 0);
        // All slab/short counts must use same isPaid/_isShortPay logic as their render fns
        const s15   = (DB.invoices || []).filter(i => !isPaid(i) && i.slabPct === '1.5').length;
        const s1    = (DB.invoices || []).filter(i => !isPaid(i) && i.slabPct === '1').length;
        const sNil  = (DB.invoices || []).filter(i => !isPaid(i) && (!i.slabPct || i.slabPct === '0')).length;
        // Use _isShortPay() — same function used by Short Payments table
        const sp    = (DB.invoices || []).filter(i => _isShortPay(i)).length;
        txt('badge-s15',  s15);
        txt('badge-s1',   s1);
        txt('badge-sNil', sNil);
        txt('badge-sp',   sp);
      }

      function emptyRow(cols, msg) {
        return `<tr><td colspan="${cols}" class="center" style="padding:28px;color:var(--muted);font-size:12px">${msg || 'No data found'}</td></tr>`;
      }

      function _populateFilters() {
        // Searchable party dropdowns — overdue + slab sections
        const _partyOpts2 = [{value:'',label:'All Parties',sub:''}].concat(
          (DB.parties||[]).filter(p=>p.status==='Active').map(p=>({value:p.partyID,label:p.name,sub:p.partyCode||''}))
        );
        [
          {id:'od-party-sd', cb: renderOverdue},
          {id:'s15-party-sd', cb: ()=>renderSlabDue('15')},
          {id:'s1-party-sd',  cb: ()=>renderSlabDue('1')},
          {id:'sNil-party-sd',cb: ()=>renderSlabDue('Nil')}
        ].forEach(function(x) {
          const el = document.getElementById(x.id);
          if (!el) return;
          if (!el._sdInit) { sdInit(x.id, _partyOpts2, x.cb, 'All Parties'); el._sdInit = true; }
          else { sdSetOptions(x.id, _partyOpts2); }
        });
        // Overdue party filter
        _buildPartyDatalist('od-party-dl');
        // Slab party filters
        ['s15','s1','sNil'].forEach(pfx => { _buildPartyDatalist(pfx+'-party-dl'); }); }

      const _ssState = {}; // { wrapperId: { value, text } }

      function buildSS(wid, options, onSelect, placeholder) {
        const wrap = document.getElementById(wid);
        if (!wrap) return;
        wrap.className = 'ss-wrap';
        wrap.innerHTML = `
    <input class="ss-input" id="${wid}-inp" readonly placeholder="${placeholder || '-- Select --'}"
      onfocus="openSS('${wid}')" onclick="openSS('${wid}')" autocomplete="off">
    <i class="fas fa-chevron-down ss-caret" id="${wid}-caret"></i>
    <div class="ss-drop" id="${wid}-drop">
      <div class="ss-search-box" style="position:relative">
        <i class="fas fa-search ss-search-icon"></i>
        <input class="ss-search" id="${wid}-q" placeholder="Search..." oninput="filterSS('${wid}')">
      </div>
      <div class="ss-list" id="${wid}-list"></div>
    </div>`;
        _ssState[wid] = { value: '', text: '', options, onSelect };
        renderSSList(wid, '');
        document.addEventListener('click', e => {
          if (!wrap.contains(e.target)) closeSS(wid);
        });
      }

      function openSS(wid) {
        const drop = document.getElementById(wid + '-drop');
        const inp = document.getElementById(wid + '-inp');
        if (!drop) return;
        drop.classList.add('open');
        inp.classList.add('open');
        setTimeout(() => { const q = document.getElementById(wid + '-q'); if (q) { q.value = ''; q.focus(); } }, 50);
        renderSSList(wid, '');
      }

      function closeSS(wid) {
        const drop = document.getElementById(wid + '-drop');
        const inp = document.getElementById(wid + '-inp');
        if (drop) drop.classList.remove('open');
        if (inp) inp.classList.remove('open');
      }

      function filterSS(wid) {
        const q = (document.getElementById(wid + '-q') || {}).value || '';
        renderSSList(wid, q);
      }

      function renderSSList(wid, q) {
        const st = _ssState[wid]; if (!st) return;
        const list = document.getElementById(wid + '-list'); if (!list) return;
        const lq = q.toLowerCase();
        const filtered = st.options.filter(o =>
          !lq || o.name.toLowerCase().includes(lq) ||
          (o.meta || '').toLowerCase().includes(lq)
        );
        if (!filtered.length) {
          list.innerHTML = '<div class="ss-empty">No results found</div>';
          return;
        }
        list.innerHTML = filtered.map(o =>
          `<div class="ss-opt" onclick="selectSS('${wid}','${escQ(o.id)}','${escQ(o.name)}')">
      <div class="ss-name">${o.name}</div>
      ${o.meta ? `<div class="ss-meta">${o.meta}</div>` : ''}
    </div>`
        ).join('');
      }

      function selectSS(wid, id, name) {
        const st = _ssState[wid]; if (!st) return;
        st.value = id; st.text = name;
        const inp = document.getElementById(wid + '-inp');
        if (inp) inp.value = name;
        closeSS(wid);
        if (typeof st.onSelect === 'function') st.onSelect(id, name);
      }

      function getSS(wid) { return (_ssState[wid] || {}).value || ''; }
      function resetSS(wid) {
        if (_ssState[wid]) { _ssState[wid].value = ''; _ssState[wid].text = ''; }
        const inp = document.getElementById(wid + '-inp');
        if (inp) inp.value = '';
      }

      function renderStars(r) {
        if (!r || !r.stars) return '';
        let h = '<div style="display:flex;gap:2px;margin-top:3px" title="Avg Delay: ' + r.delay + ' days">';
        for (let i = 1; i <= 5; i++) {
          h += `<i class="fas fa-star" style="font-size:10px;color:${i <= r.stars ? '#FBBF24' : '#E2E8F0'}"></i>`;
        }
        h += `<span style="font-size:9px;color:var(--muted);margin-left:4px">${r.label}</span>`;
        h += '</div>';
        return h;
      }

      function _buildAllPartySS() {
        // Reports filter
        sdInit('rpt-ss', _partyOptions(true), (v) => { loadReports(); }, 'All Parties');
        const opts = (DB.parties || []).map(p => ({
          id: p.partyID, name: p.name,
          meta: [p.city, p.partyCode, p.head].filter(v => v && v !== '--').join(' | ')
        }));

        if (document.getElementById('rp-ss')) {
          buildSS('rp-ss', opts, id => onRPPartyID(id), 'Search party...');
        }
        if (document.getElementById('ai-ss')) {
          buildSS('ai-ss', opts, id => onAIPartyID(id), 'Search party...');
        }
        if (document.getElementById('fu-ss')) {
          buildSS('fu-ss', opts, id => onFUPartyID(id), 'Search party...');
        }
        if (document.getElementById('rpt-ss')) {
          const rptOpts = [{ id: '', name: 'All Parties', meta: '' }].concat(opts);
          buildSS('rpt-ss', rptOpts, () => loadReports(), 'All Parties');
        }
        if (document.getElementById('inv-ss')) {
          const invOpts = [{ id: '', name: 'All Parties', meta: '' }].concat(opts);
          buildSS('inv-ss', invOpts, () => { _pState.invoices = 1; renderInvoices(); }, 'All Parties');
        }
      }

      function onAIPartyID(partyID) {
        const p = (DB.parties || []).find(x => x.partyID === partyID);
        if (!p) return;
        const s = id => document.getElementById(id);
        if (s('ai-party-id')) s('ai-party-id').value = p.partyID;
        if (s('ai-party-code')) s('ai-party-code').value = p.partyCode || '';
        if (s('ai-party-name')) s('ai-party-name').value = p.name;
        onAIParty(partyID);
      }

      function onRPPartyID(partyID) {
        const p = (DB.parties || []).find(x => x.partyID === partyID);
        if (!p) return;
        const s = id => document.getElementById(id);
        if (s('rp-party-id')) s('rp-party-id').value = p.partyID;
        if (s('rp-party-code')) s('rp-party-code').value = p.partyCode || '';
        if (s('rp-party-name')) s('rp-party-name').value = p.name;
        onRPParty(partyID);
      }

      function onFUPartyID(partyID) {
        const p = (DB.parties || []).find(x => x.partyID === partyID);
        if (!p) return;
        const s = id => document.getElementById(id);
        if (s('fu-party-id')) s('fu-party-id').value = p.partyID;
        if (s('fu-party-code')) s('fu-party-code').value = p.partyCode || '';
        if (s('fu-party-name')) s('fu-party-name').value = p.name;
        onFUParty(partyID);
      }

      function downloadTemplate() {
        const headers = [
          'DATE', 'BILL NO.', 'QTY', 'PCS/CASE', 'NAME', 'CITY', 'DESCRIPTION',
          'BILL VALUE', 'C.GST', 'S.GST', 'I.GST', 'CESS',
          'EXP1', 'EXP2', 'EXP3', 'EXP4', 'EXP5',
          '194Q', 'TCS.1H', 'EXP6', 'EXP7', 'EXP8', 'EXP9', 'EXP10',
          'TCS', 'NET VALUE', 'VEHICLE NO.'
        ];
        const sample = [
          '23-03-2026', 'FRESKO-25393', '42.45', '0',
          'M.K. Industrial Corporation', 'Mandi Gobindgarh', 'FLAT BAR',
          '256198', '19541', '19541', '0', '0',
          '0', '0', '0', '0', '0',
          '0', '0', '0', '0', '0', '0', '0',
          '0', '217116', 'HR38AD5167'
        ];
        const note = [
          'dd-mm-yyyy', 'Bill number', 'Optional', 'Optional',
          'Must match Parties table name', 'Optional', 'Optional',
          'Gross amount', 'CGST', 'SGST', 'IGST', 'Cess',
          '', '', '', '', '',
          '', '', '', '', '', '', '',
          'TCS', 'Final payable <- used for invoice amount', 'Vehicle number'
        ];
        const csv = [headers.join(','), sample.join(','), note.join(',')].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Fresko_Invoice_Template.csv';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }

      const ICONS = {
        followup: 'fa-phone-alt',      // Log Follow-up -- always phone-alt
        payment: 'fa-indian-rupee-sign',     // Record Payment -- always rupee-sign
        view: 'fa-eye',            // View detail
        edit: 'fa-pencil-alt',     // Edit
        delete: 'fa-trash-alt',      // Delete
        promise: 'fa-handshake',      // Promise Tracker
        escalate: 'fa-arrow-up',       // Escalation
        whatsapp: 'fa-whatsapp',       // WhatsApp
        call: 'fa-phone',          // Direct call link
        report: 'fa-chart-bar',      // Reports
        upload: 'fa-cloud-upload-alt', // Upload
        download: 'fa-download',       // Download
        add: 'fa-plus',           // Add/New
        save: 'fa-save',           // Save form
        cancel: 'fa-times',          // Cancel/Close
        refresh: 'fa-sync-alt',       // Refresh
        check: 'fa-check',          // Confirm/Kept
        cross: 'fa-times',          // Broken/No
      };

      function actionBtn(type, onclick, label, extraClass) {
        const iconMap = {
          followup: { ic: 'fa-phone-alt', cls: 'btn-amber', tip: 'Log Follow-up' },
          payment: { ic: 'fa-indian-rupee-sign', cls: 'btn-primary', tip: 'Record Payment' },
          view: { ic: 'fa-eye', cls: 'btn-ghost', tip: 'View Detail' },
          kept: { ic: 'fa-check', cls: 'btn-green', tip: 'Mark Kept' },
          broken: { ic: 'fa-times', cls: 'btn-secondary', tip: 'Mark Broken' },
        };
        const m = iconMap[type] || { ic: 'fa-circle', cls: 'btn-ghost', tip: '' };
        const lbl = label ? ` ${label}` : '';
        return `<button class="btn btn-sm ${m.cls} ${extraClass || ''}" onclick="${onclick}" title="${m.tip}">
    <i class="fas ${m.ic}" style="font-size:10px"></i>${lbl}
  </button>`;
      }

      function partyAC(inputId, dropId, onSelect) {
        const inp = document.getElementById(inputId);
        const drop = document.getElementById(dropId);
        const val = (inp.value || '').toLowerCase();
        if (!val) { drop.classList.remove('show'); return; }
        const matches = (DB.parties || []).filter(p =>
          p.name.toLowerCase().includes(val) ||
          (p.partyCode || '').toLowerCase().includes(val) ||
          (p.city || '').toLowerCase().includes(val)
        ).slice(0, 12);
        if (!matches.length) { drop.classList.remove('show'); return; }
        drop.innerHTML = matches.map(p =>
          `<div class="ac-item" onclick="acSelect('${escQ(inputId)}','${escQ(dropId)}','${escQ(p.partyID)}','${escQ(p.partyCode)}','${escQ(p.name)}')">
      <div class="ac-name">${p.name}</div>
      <div class="ac-sub">${p.city || ''}  ${p.partyCode || ''}  ${p.head || ''}</div>
    </div>`
        ).join('');
        drop.classList.add('show');
      }

      function acSelect(inputId, dropId, partyID, partyCode, partyName) {
        document.getElementById(inputId).value = partyName;
        document.getElementById(dropId).classList.remove('show');
        const prefix = inputId.replace('-party-inp', '').replace('-inp', '');
        const setHid = (suf, val) => { const e = document.getElementById(prefix + '-party-' + suf); if (e) e.value = val; };
        setHid('id', partyID); setHid('code', partyCode); setHid('name', partyName);
        if (inputId === 'ai-party-inp') onAIParty(partyID);
        if (inputId === 'rp-party-inp') onRPParty(partyID);
        if (inputId === 'fu-party-inp') onFUParty(partyID);
      }

      function renderDashboard() {
        const s = DB.stats || {};
        txt('s-outstanding', INR(s.totalOutstanding || 0));
        txt('s-parties', (s.totalParties || 0) + ' parties');
        txt('s-overdue', INR(s.totalOverdue || 0));
        txt('s-overdue-c', (s.overdueCount || 0) + ' invoices');
        txt('s-today', INR(s.totalDueToday || 0));
        txt('s-today-c', (s.dueTodayCount || 0) + ' invoices');
        txt('s-collected', INR(s.collectedThisMonth || 0));
        txt('s-coll-c', (s.collectedCount || 0) + ' payments');

        let s15 = 0, s1 = 0, s0 = 0, c15 = 0, c1 = 0, c0 = 0;
        (DB.invoices || []).forEach(inv => {
          if (isPaid(inv)) return;
          const p = pending(inv);
          if (inv.slabPct === '1.5') { s15 += p; c15++; }
          else if (inv.slabPct === '1') { s1 += p; c1++; }
          else { s0 += p; c0++; }
        });
        txt('slab-15-amt', INR(s15)); txt('slab-15-cnt', c15 + ' invoices');
        txt('slab-1-amt', INR(s1)); txt('slab-1-cnt', c1 + ' invoices');
        txt('slab-0-amt', INR(s0)); txt('slab-0-cnt', c0 + ' invoices');

        const odList = (DB.invoices || []).filter(i => !isPaid(i) && daysOD(i) > 0)
          .sort((a, b) => daysOD(b) - daysOD(a));
        txt('dash-od-badge', odList.length);
        const odEl = document.getElementById('dash-overdue-list');
        odEl.innerHTML = odList.length === 0
          ? '<div class="empty"><i class="fas fa-check-circle" style="color:var(--green)"></i><p>All clear!</p></div>'
          : odList.slice(0, 10).map(inv => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #F8FAFC;cursor:pointer" onclick="openPartyModal('${escQ(inv.partyID)}')">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;truncate:ellipsis;overflow:hidden;white-space:nowrap">${inv.partyName}</div>
          <div style="font-size:10px;color:var(--muted)">${inv.invoiceNo}  Due ${inv.dueDate}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:12px;font-weight:700;color:var(--red)">${INR(pending(inv))}</div>
          ${ageBadge(daysOD(inv))}
        </div>
      </div>`).join('');

        renderFUPanel();
      }

      function setFuTab(t) {
        _fuTab = t;
        const a = 'font-size:10px;font-weight:700;padding:3px 8px;border-radius:4px;border:none;cursor:pointer';
        document.getElementById('fu-tab-today').style.cssText = a + (t === 'today' ? ';background:#fff;color:var(--red)' : ';background:transparent;color:var(--muted)');
        document.getElementById('fu-tab-recent').style.cssText = a + (t === 'recent' ? ';background:#fff;color:var(--red)' : ';background:transparent;color:var(--muted)');
        renderFUPanel();
      }

      function renderFUPanel() {
        const el = document.getElementById('dash-fu-list');
        const ts = todayStr();
        const list = _fuTab === 'today'
          ? (DB.followups || []).filter(f => isToday(f.datetime)).reverse()
          : [...(DB.followups || [])].reverse().slice(0, 12);

        if (!list.length) {
          el.innerHTML = `<div class="empty"><i class="fas fa-calendar-check"></i><p>${_fuTab === 'today' ? 'No follow-ups today' : 'No follow-ups logged'}</p><small><button style="color:var(--red);font-weight:600;background:none;border:none;cursor:pointer;font-size:11px" onclick="openFUModal()">+ Log one now</button></small></div>`;
          return;
        }
        el.innerHTML = list.map(f => {
          const time = (f.datetime || '').split(' ')[1] || '';
          const bg = modeBg(f.mode);
          return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-bottom:1px solid #F8FAFC;cursor:pointer" onclick="openPartyModal('${escQ(f.partyID)}')">
      <div style="width:28px;height:28px;border-radius:50%;background:${bg.split(';')[0]};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
        <i class="fas ${modeIcon(f.mode)}" style="font-size:10px;color:${bg.split(':')[1]}"></i>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <span style="font-size:12px;font-weight:600;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${f.partyName}</span>
          <span style="font-size:10px;color:var(--muted);font-family:monospace;flex-shrink:0;margin-left:6px">${time}</span>
        </div>
        <div style="font-size:11px;color:var(--muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-top:1px">${f.notes}</div>
        ${f.promiseDate ? `<div style="font-size:10px;color:var(--amber);margin-top:2px"><i class="fas fa-calendar-alt" style="margin-right:3px"></i>Promise: ${f.promiseDate}</div>` : ''}
      </div>
    </div>`;
        }).join('');
      }

      function renderTodayDue() {
        const ts = todayStr();
        document.getElementById('td-date').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

        const dueToday = (DB.invoices || []).filter(i => !isPaid(i) && i.dueDate === ts);
        const overdueAll = (DB.invoices || []).filter(i => !isPaid(i) && daysOD(i) > 0);
        const fuToday = (DB.followups || []).filter(f => isToday(f.datetime));

        const dtAmt = dueToday.reduce((s, i) => s + pending(i), 0);
        const odAmt = overdueAll.reduce((s, i) => s + pending(i), 0);

        txt('td-amt', INR(dtAmt)); txt('td-cnt', dueToday.length + ' invoices');
        txt('td-od-amt', INR(odAmt)); txt('td-od-cnt', overdueAll.length + ' invoices');
        txt('td-fu-cnt', fuToday.length);
        txt('td-badge', dueToday.length);

        const tdEl = document.getElementById('td-invoice-list');
        tdEl.innerHTML = dueToday.length === 0
          ? '<div class="empty"><i class="fas fa-check-circle" style="color:var(--green)"></i><p>No bills due today</p></div>'
          : dueToday.map(inv => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #F8FAFC">
        <div style="flex:1;min-width:0;cursor:pointer" onclick="openPartyModal('${escQ(inv.partyID)}')">
          <div style="font-size:12px;font-weight:600">${inv.partyName}</div>
          <div style="font-size:10px;color:var(--muted)">${inv.invoiceNo}  Net ${INR(inv.netAmount)}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:13px;font-weight:700;color:var(--amber)">${INR(pending(inv))}</div>
          ${slabBadge(inv.slabPct)}
        </div>
        <div style="display:flex;gap:6px;justify-content:flex-end">
          <button class="act-btn ab-edit admin-only" onclick="openEditInvoiceModal('${escQ(inv.invoiceID)}')" title="Edit Invoice"><i class="fas fa-edit"></i></button>
          <button class="act-btn ab-fu" onclick="openFUModalForParty('${escQ(inv.partyID)}','${escQ(inv.invoiceNo)}')" title="Log Follow-up"><i class="fas fa-phone-alt"></i></button>
          <button class="act-btn ab-pay" onclick="openRPModalForParty('${escQ(inv.partyID)}')" title="Record Payment"><i class="fas fa-indian-rupee-sign"></i></button>
        </div>
      </div>`).join('');

        const fuEl = document.getElementById('td-fu-list');
        fuEl.innerHTML = fuToday.length === 0
          ? `<div class="empty"><i class="fas fa-phone-slash"></i><p>No follow-ups logged today</p><small><button style="color:var(--red);font-weight:600;background:none;border:none;cursor:pointer" onclick="openFUModal()">+ Log one</button></small></div>`
          : fuToday.reverse().map(f => {
            const bg = modeBg(f.mode);
            return `<div style="display:flex;align-items:flex-start;gap:10px;padding:9px 14px;border-bottom:1px solid #F8FAFC">
          <div style="width:28px;height:28px;border-radius:50%;background:${bg.split(';')[0]};display:flex;align-items:center;justify-content:center;flex-shrink:0">
            <i class="fas ${modeIcon(f.mode)}" style="font-size:10px;color:${bg.split(':')[1]}"></i>
          </div>
          <div style="flex:1;min-width:0">
            <div style="display:flex;justify-content:space-between">
              <span style="font-size:12px;font-weight:600">${f.partyName}</span>
              <span style="font-size:10px;color:var(--muted);font-family:monospace">${(f.datetime || '').split(' ')[1] || ''}</span>
            </div>
            <div style="font-size:11px;color:var(--muted);margin-top:1px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${f.notes}</div>
            ${f.promiseDate ? `<div style="font-size:10px;color:var(--amber);margin-top:2px">Promise: ${INR(f.promiseAmt)} by ${f.promiseDate}</div>` : ''}
          </div>
        </div>`;
          }).join('');
      }

      function renderOverdue() {
        const q = ((document.getElementById('od-search')||{}).value||'').toLowerCase();
        const pfInp = (document.getElementById('od-party-filter-inp')||{}).value||'';
        const pf = pfInp ? ((DB.parties||[]).find(p=>p.name.toLowerCase()===pfInp.toLowerCase().trim())||{}).partyID||'' : '';
        const overdue = (DB.invoices || []).filter(i => {
          if (isPaid(i) || daysOD(i) <= 0) return false;
          if (pf && i.partyID !== pf) return false;
          if (q && !i.partyName.toLowerCase().includes(q) && !i.invoiceNo.toLowerCase().includes(q)) return false;
          return true;
        }).sort((a, b) => daysOD(b) - daysOD(a));

        const totalAmt = overdue.reduce((s, i) => s + pending(i), 0);
        txt('od-total-badge', INR(totalAmt) + ' overdue');

        let b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0;
        overdue.forEach(i => {
          const d = daysOD(i), p = pending(i);
          if (d <= 7) b1 += p; else if (d <= 15) b2 += p; else if (d <= 30) b3 += p; else if (d <= 60) b4 += p; else b5 += p;
        });
        txt('od-b1', INR(b1)); txt('od-b2', INR(b2)); txt('od-b3', INR(b3)); txt('od-b4', INR(b4)); txt('od-b5', INR(b5));

        const lastFU = {};
        (DB.followups || []).forEach(f => {
          if (!lastFU[f.partyID] || f.datetime > lastFU[f.partyID].datetime)
            lastFU[f.partyID] = f;
        });

        const tbody = document.getElementById('od-tbody');
        tbody.innerHTML = overdue.length === 0
          ? emptyRow(8, '[OK] No overdue invoices')
          : overdue.map(inv => {
            const days = daysOD(inv);
            const lfu = lastFU[inv.partyID];
            return `<tr style="cursor:pointer" onclick="openPartyModal('${escQ(inv.partyID)}')">
          <td><span style="font-weight:600">${inv.partyName}</span></td>
          <td style="font-family:monospace;font-size:11px">${inv.invoiceNo}</td>
          <td style="font-size:11px">${inv.dueDate}</td>
          <td class="center">${ageBadge(days)}</td>
          <td class="num" style="color:var(--red);font-weight:700">${INR(pending(inv))}</td>
          <td style="font-size:11px;color:var(--muted)">${lfu ? (lfu.datetime || '').split(' ')[0] + '  ' + lfu.mode : '--'}</td>
          <td class="center">${priorityBadge(lfu ? lfu.priority : 'High')}</td>
          <td onclick="event.stopPropagation()" style="white-space:nowrap;text-align:right">
            <button class="act-btn ab-edit admin-only" onclick="openEditInvoiceModal('${escQ(inv.invoiceID)}')" title="Edit Invoice"><i class="fas fa-edit"></i></button>
            <button class="act-btn ab-fu" onclick="openFUModalForParty('${escQ(inv.partyID)}','${escQ(inv.invoiceNo)}')" title="Log Follow-up"><i class="fas fa-phone-alt"></i></button>
            <button class="act-btn ab-pay" onclick="openRPModalForParty('${escQ(inv.partyID)}')" title="Record Payment"><i class="fas fa-indian-rupee-sign"></i></button>
          </td>
        </tr>`;
          }).join('');
      }

      let _partyFilter = 'ALL';
      function setPartyFilter(el, f) {
        document.querySelectorAll('#view-parties .fpill').forEach(e => e.classList.remove('active'));
        if (el) el.classList.add('active');
        _partyFilter = f; _pState.parties = 1; renderParties();
      }
      function setPartyFilterDrop(f) {
        _partyFilter = f || 'ALL'; _pState.parties = 1; renderParties();
      }
      function _updatePager(prefix, page, total) {
        const totalPages = Math.max(1, Math.ceil(total / PER));
        const prev = document.getElementById(prefix + '-prev');
        const next = document.getElementById(prefix + '-next');
        const pg = document.getElementById(prefix + '-page');
        if (prev) prev.disabled = page <= 1;
        if (next) next.disabled = page >= totalPages;
        if (pg) pg.textContent = page + ' / ' + totalPages;
      }

      function partyPage(d) {
        const total = _filtered.parties.length;
        _pState.parties = Math.max(1, Math.min(_pState.parties + d, Math.ceil(total / PER)));
        renderParties();
      }
      function invPage(d) {
        const total = _filtered.invoices.length;
        _pState.invoices = Math.max(1, Math.min(_pState.invoices + d, Math.ceil(total / PER)));
        renderInvoices();
      }
      function payPage(d) {
        const total = _filtered.payments.length;
        _pState.payments = Math.max(1, Math.min(_pState.payments + d, Math.ceil(total / PER)));
        renderPayments();
      }
      function fuPage(d) {
        const total = _filtered.followups.length;
        _pState.followups = Math.max(1, Math.min(_pState.followups + d, Math.ceil(total / PER)));
        renderFollowups();
      }

      function renderParties() {
        const search = (document.getElementById('party-search') || {}).value || '';
        const q = search.toLowerCase();
        const today = new Date(); today.setHours(0, 0, 0, 0);

        let list = (DB.parties || []).filter(p => {
          if (_partyFilter === '15') return p.days15 != null;
          if (_partyFilter === '1') return p.days1 != null && p.days15 == null;
          if (_partyFilter === 'nil') return p.days15 == null && p.days1 == null;
          if (_partyFilter === 'A') return p.category === 'A';
          if (_partyFilter === 'overdue') {
            return (DB.invoices || []).some(i => i.partyID === p.partyID && !isPaid(i) && daysOD(i) > 0);
          }
          if (_partyFilter === 'r5') return p.rating && p.rating.stars === 5;
          if (_partyFilter === 'r4') return p.rating && p.rating.stars === 4;
          if (_partyFilter === 'r3') return p.rating && p.rating.stars === 3;
          if (_partyFilter === 'r12') return p.rating && p.rating.stars <= 2;
          return true;
        }).filter(p =>
          !q || p.name.toLowerCase().includes(q) ||
          (p.partyCode || '').toLowerCase().includes(q) ||
          (p.city || '').toLowerCase().includes(q)
        );

        _filtered.parties = list;
        const total = list.length;
        const page = list.slice((_pState.parties - 1) * PER, _pState.parties * PER);

        txt('parties-sub', total + ' parties found');
        const selEl = document.getElementById('party-filter-sel');
        if (selEl && selEl.value !== _partyFilter) selEl.value = _partyFilter;
        const cntEl = document.getElementById('party-filter-count');
        if (cntEl) cntEl.textContent = _partyFilter !== 'ALL' ? total + ' found' : '';
        txt('parties-info', `${((_pState.parties - 1) * PER) + 1}-${Math.min(_pState.parties * PER, total)} of ${total} parties`);
        _updatePager('parties', _pState.parties, total);

        const tbody = document.getElementById('parties-tbody');
        tbody.innerHTML = page.length === 0 ? emptyRow(7, 'No parties found') :
          page.map(p => {
            const out = (DB.invoices || []).filter(i => i.partyID === p.partyID && !isPaid(i)).reduce((s, i) => s + pending(i), 0);
            const isOD = (DB.invoices || []).some(i => i.partyID === p.partyID && !isPaid(i) && daysOD(i) > 0);
            const slab = p.days15 ? '1.5%' : p.days1 ? '1%' : 'Nil';
            const slabC = p.days15 ? 'slab-15' : p.days1 ? 'slab-1' : 'slab-0';
            return `<tr style="cursor:pointer" onclick="openPartyModal('${escQ(p.partyID)}')">
        <td>
          <div style="font-weight:600;font-size:12px">${p.name}</div>
          <div style="font-size:10px;color:var(--muted)">${p.partyCode || ''}${p.contact ? '  ' + p.contact : ''}</div>
          ${renderStars(p.rating)}
        </td>
        <td style="font-size:11px">${p.city || '--'}</td>
        <td style="font-size:11px">${p.head || '--'}</td>
        <td><span class="${slabC}">${slab}</span></td>
        <td class="num" style="${out > 0 && isOD ? 'color:var(--red);font-weight:700' : 'font-weight:600'}">${INR(out)}</td>
        <td><span class="badge ${p.status === 'Active' ? 'badge-active' : 'badge-inactive'}">${p.status || 'Active'}</span></td>
        <td onclick="event.stopPropagation()" style="white-space:nowrap;text-align:right">
          ${p.phone ? `<a href="tel:${p.phone}" class="act-btn ab-call" style="text-decoration:none" title="Call"><i class="fas fa-phone"></i></a>` : ''}
          ${p.phone ? `<a href="https://wa.me/91${p.phone.replace(/\D/g, '')}" target="_blank" class="act-btn ab-wa" title="WhatsApp"><i class="fab fa-whatsapp"></i></a>` : ''}
          <button class="act-btn ab-edit admin-only" onclick="openEditPartyModal('${escQ(p.partyID)}')" title="Edit Party"><i class="fas fa-edit"></i></button>
          <button class="act-btn ab-fu" onclick="openFUModalForParty('${escQ(p.partyID)}','')" title="Log Follow-up"><i class="fas fa-phone-alt"></i></button>
          <button class="act-btn ab-pay" onclick="openRPModalForParty('${escQ(p.partyID)}')" title="Record Payment"><i class="fas fa-indian-rupee-sign"></i></button>
        </td>
      </tr>`;
          }).join('');
      }

      let _invFilter = 'ALL';
      function setInvFilter(el, f) {
        document.querySelectorAll('#view-invoices .fpill').forEach(e => e.classList.remove('active'));
        el.classList.add('active');
        _invFilter = f; _pState.invoices = 1; renderInvoices();
      }

      function renderInvoices() {
        const q = ((document.getElementById('inv-search') || {}).value || '').toLowerCase();
        const pf = (_ssState['inv-ss'] && _ssState['inv-ss'].value) || '';
        const from = (document.getElementById('inv-from') || {}).value || '';
        const to = (document.getElementById('inv-to') || {}).value || '';
        const today = new Date(); today.setHours(0, 0, 0, 0);

        let list = (DB.invoices || []).filter(inv => {
          if (_invFilter === 'Pending') return inv.status === 'Pending';
          if (_invFilter === 'PartPaid') return inv.status === 'PartPaid';
          if (_invFilter === 'Overdue') return !isPaid(inv) && daysOD(inv) > 0;
          if (_invFilter === 'Paid') return isPaid(inv);
          return true;
        }).filter(inv => {
          const d = parseIST(inv.invoiceDate);
          if (from && d && d < new Date(from)) return false;
          if (to && d && d > new Date(to + 'T23:59:59')) return false;
          return (!q || inv.invoiceNo.toLowerCase().includes(q) || inv.partyName.toLowerCase().includes(q)) &&
            (!pf || inv.partyID === pf);
        }).sort((a, b) => (parseIST(b.invoiceDate) || 0) - (parseIST(a.invoiceDate) || 0));

        _filtered.invoices = list;
        const total = list.length;
        const page = list.slice((_pState.invoices - 1) * PER, _pState.invoices * PER);
        const tbody = document.getElementById('inv-tbody');

        txt('inv-sub', total + ' invoices');
        txt('inv-info', `${((_pState.invoices - 1) * PER) + 1}-${Math.min(_pState.invoices * PER, total)} of ${total} invoices`);
        _updatePager('inv', _pState.invoices, total);

        if (!tbody) return;
        tbody.innerHTML = page.length === 0 ? emptyRow(11, 'No invoices found') :
          page.map(inv => {
            const pend = pending(inv);
            const od = daysOD(inv);
            const sts = isPaid(inv) ? 'Paid' : od > 0 ? 'Overdue' : (inv.paidAmount > 0 ? 'PartPaid' : 'Pending');
            return `<tr>
        <td style="font-family:monospace;font-size:11px;font-weight:600">${inv.invoiceNo}</td>
        <td style="cursor:pointer" onclick="openPartyModal('${escQ(inv.partyID)}')">
          <div style="font-size:12px;font-weight:600">${inv.partyName}</div>
          <div style="font-size:10px;color:var(--muted)">${inv.partyCode || ''}</div>
        </td>
        <td style="font-size:11px">${inv.invoiceDate}</td>
        <td style="font-size:11px${od > 0 ? ' ;font-weight:700;color:var(--red)' : ''}">${inv.dueDate}${od > 0 ? ' ' + ageBadge(od) : ''}</td>
        <td>${slabBadge(inv.slabPct)}</td>
        <td class="num">${INR(inv.billValue)}</td>
        <td class="num" style="${(inv.difference||0)!==0?'color:var(--red);font-weight:700':'color:var(--muted)'}">${(inv.difference||0)!==0?INR(inv.difference):'--'}</td>
        <td class="num" style="color:var(--green)">${INR(inv.paidAmount)}</td>
        <td class="num" style="${pend > 0 ? 'color:var(--red);font-weight:700' : 'color:var(--muted)'}">${pend > 0 ? INR(pend) : '--'}</td>
        <td>${statusBadge(sts)}</td>
        <td style="white-space:nowrap;text-align:right">
          <button class="act-btn ab-view" onclick="openPartyModal('${escQ(inv.partyID)}')" title="View Party"><i class="fas fa-eye"></i></button>
          <button class="act-btn ab-edit admin-only" onclick="openEditInvoiceModal('${escQ(inv.invoiceID)}')" title="Edit Invoice"><i class="fas fa-edit"></i></button>
          ${!isPaid(inv) ? `<button class="act-btn ab-fu" onclick="openFUModalForParty('${escQ(inv.partyID)}','${escQ(inv.invoiceNo)}')" title="Log Follow-up"><i class="fas fa-phone-alt"></i></button>` : ''}
          ${!isPaid(inv) ? `<button class="act-btn ab-pay" onclick="openRPModalForParty('${escQ(inv.partyID)}')" title="Record Payment"><i class="fas fa-indian-rupee-sign"></i></button>` : ''}
        </td>
      </tr>`;
          }).join('');
      }

      function renderPendingSummary() {
        if (!DB || !DB.invoices) { txt('pi-sub', 'Loading...'); return; }
        const q = ((document.getElementById('pi-search')||{}).value||'').toLowerCase();
        const invoices = (DB.invoices || []).filter(inv => {
          if (isPaid(inv)) return false;
          if (q && !inv.partyName.toLowerCase().includes(q) && !inv.invoiceNo.toLowerCase().includes(q)) return false;
          return true;
        });
        const grouped = {};
        invoices.forEach(inv => {
          if (!grouped[inv.partyID]) {
            grouped[inv.partyID] = {
              partyName: inv.partyName,
              partyID: inv.partyID,
              count: 0,
              totalBillValue: 0,
              totalPending: 0,
              oldestDate: null
            };
          }
          const g = grouped[inv.partyID];
          g.count++;
          g.totalBillValue += inv.billValue;
          g.totalPending += pending(inv);
          const d = parseIST(inv.dueDate);
          if (!g.oldestDate || (d && d < g.oldestDate)) g.oldestDate = d;
        });

        const list = Object.values(grouped).sort((a, b) => b.totalPending - a.totalPending);
        const totalPendingAmt = list.reduce((s, g) => s + g.totalPending, 0);
        txt('pi-sub', list.length + ' parties — ' + INR(totalPendingAmt) + ' total pending');
        const tbody = document.getElementById('inv-pending-summary-tbody');
        if (!tbody) return;

        tbody.innerHTML = list.length === 0 ? emptyRow(6, 'No pending invoices') :
          list.map(g => {
            const dateStr = g.oldestDate ? (d => String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear())(g.oldestDate) : '--';
            const od = g.oldestDate ? Math.floor((new Date() - g.oldestDate) / 86400000) : 0;
            return `<tr>
              <td style="font-weight:600;cursor:pointer" onclick="openPartyModal('${escQ(g.partyID)}')">${g.partyName}</td>
              <td class="num">${g.count} bills</td>
              <td class="num">${INR(g.totalBillValue)}</td>
              <td class="num" style="color:var(--red);font-weight:800">${INR(g.totalPending)}</td>
              <td>${dateStr} ${od > 0 ? ageBadge(od) : ''}</td>
              <td style="white-space:nowrap;text-align:right">
                <button class="act-btn ab-fu" onclick="openFUModalForParty('${escQ(g.partyID)}','')" title="Log Follow-up"><i class="fas fa-phone-alt"></i></button>
                <button class="act-btn ab-pay" onclick="openRPModalForParty('${escQ(g.partyID)}')" title="Record Payment"><i class="fas fa-indian-rupee-sign"></i></button>
              </td>
            </tr>`;
          }).join('');
      }

      let _paySort = { col: 'date', dir: -1 };
      let _payExpanded = {};
      function setPaySort(col) {
        if (_paySort.col === col) _paySort.dir *= -1; else { _paySort.col = col; _paySort.dir = -1; }
        _payExpanded = {}; // reset so new sort order starts fresh (all open)
        renderPayments();
      }
      function togglePayGroup(idx) {
        const isOpen = _payExpanded[idx] !== false; // undefined/true = open, false = closed
        _payExpanded[idx] = !isOpen;                // toggle
        renderPayments();
      }
      function toggleLPGroup(tr) {
        if (!window._lpExpanded) window._lpExpanded = {};
        const idx = +tr.dataset.idx;
        const isOpen = tr.dataset.isopen === '1';
        window._lpExpanded[idx] = !isOpen;
        renderLatePay();
      }

      // ── Collapse / Expand All — Payments ──────────────────────────────
      function collapseAllPay() {
        const hdrs = document.querySelectorAll('.pay-group-hdr');
        hdrs.forEach(tr => { _payExpanded[+tr.dataset.idx] = false; });
        renderPayments();
      }
      function expandAllPay() {
        _payExpanded = {}; // undefined = open (default)
        renderPayments();
      }

      // ── Collapse / Expand All — Late Payments ─────────────────────────
      function collapseAllLP() {
        if (!window._lpExpanded) window._lpExpanded = {};
        const hdrs = document.querySelectorAll('.lp-group-hdr');
        hdrs.forEach(tr => { window._lpExpanded[+tr.dataset.idx] = false; });
        renderLatePay();
      }
      function expandAllLP() {
        window._lpExpanded = {}; // undefined = open (default)
        renderLatePay();
      }
      // Payment group clicks handled via direct onclick on tr
      function _paySortIcon(col) {
        if (_paySort.col !== col) return ' <i class="fas fa-sort" style="opacity:.25;font-size:9px"></i>';
        return _paySort.dir === -1
          ? ' <i class="fas fa-sort-down" style="font-size:9px;color:var(--red)"></i>'
          : ' <i class="fas fa-sort-up" style="font-size:9px;color:var(--red)"></i>';
      }
      function renderPayments() {
        const q   = ((document.getElementById('pay-search')||{}).value||'').toLowerCase();
        const mf  = ((document.getElementById('pay-mode-filter')||{}).value||'');
        const from= ((document.getElementById('pay-from')||{}).value||'');
        const to  = ((document.getElementById('pay-to')||{}).value||'');

        let list = (DB.payments||[]).filter(p => {
          const d = parseIST(p.paymentDate);
          if (!d) return false;
          if (from && d < new Date(from)) return false;
          if (to   && d > new Date(to+'T23:59:59')) return false;
          if (mf   && p.mode !== mf) return false;
          if (q    && !p.partyName.toLowerCase().includes(q) && !(p.refNo||'').toLowerCase().includes(q)) return false;
          return true;
        });

        // Group by party
        const gMap = {};
        list.forEach(p => {
          if (!gMap[p.partyID]) gMap[p.partyID] = { partyName: p.partyName, partyID: p.partyID, total: 0, latestDate: null, items: [] };
          gMap[p.partyID].total += p.amount;
          const d = parseIST(p.paymentDate);
          if (!gMap[p.partyID].latestDate || (d && d > gMap[p.partyID].latestDate)) gMap[p.partyID].latestDate = d;
          gMap[p.partyID].items.push(p);
        });

        let groups = Object.values(gMap);
        // Sort groups
        groups.sort((a, b) => {
          if (_paySort.col === 'party') return a.partyName.localeCompare(b.partyName) * _paySort.dir;
          if (_paySort.col === 'amt')   return (b.total - a.total) * _paySort.dir;
          // date: sort by latest payment date
          const ad = a.latestDate ? a.latestDate.getTime() : 0;
          const bd = b.latestDate ? b.latestDate.getTime() : 0;
          return (bd - ad) * _paySort.dir;
        });

        txt('pay-sub', list.length + ' payments across ' + groups.length + ' parties');
        txt('pay-info', list.length + ' total');
        _updatePager('pay', 1, 1);

        // Sortable header
        const thead = document.getElementById('pay-thead');
        if (thead) thead.innerHTML = '<tr>' + '<th style="cursor:pointer;user-select:none" onclick="setPaySort(&quot;party&quot;)">Party' + _paySortIcon('party') + '</th>' + '<th style="cursor:pointer;user-select:none" onclick="setPaySort(&quot;date&quot;)">Date' + _paySortIcon('date') + '</th>' + '<th>Mode</th><th>Ref No</th>' + '<th class="num" style="cursor:pointer;user-select:none" onclick="setPaySort(&quot;amt&quot;)">Amount' + _paySortIcon('amt') + '</th>' + '<th>Applied To</th><th>By</th><th class="admin-only">Edit</th></tr>';

        const tbody = document.getElementById('pay-tbody');
        if (!tbody) return;
        if (!groups.length) { tbody.innerHTML = emptyRow(8, 'No payments found'); return; }

        // Use index as key to avoid partyID escaping issues
        tbody.innerHTML = groups.map((g, idx) => {
          const isOpen = _payExpanded[idx] !== false; // default open, keyed by index
          const detailRows = g.items.map(p =>
            '<tr class="pay-det" style="font-size:11px">' +
            '<td style="padding-left:22px">' + escHTML(p.partyName) + '</td>' +
            '<td style="font-size:11px">' + p.paymentDate + '</td>' +
            '<td><span class="badge badge-pending" style="background:#E8F0FE;font-size:10px">' + p.mode + '</span></td>' +
            '<td style="color:var(--muted);font-size:11px">' + (p.refNo||'--') + '</td>' +
            '<td class="num" style="color:var(--green);font-weight:700">' + INR(p.amount) + '</td>' +
            '<td style="color:var(--muted);font-size:10px;max-width:110px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">' + (p.appliedTo||'--') + '</td>' +
            '<td style="color:var(--muted);font-size:10px">' + (p.recordedBy||'--') + '</td>' +
            '<td class="admin-only"><button class="act-btn ab-edit" onclick="openEditPaymentModal(\'' + escQ(p.paymentID) + '\')" title="Edit Payment"><i class="fas fa-edit"></i></button></td>' +
            '</tr>'
          ).join('');
          return '<tr class="pay-group-hdr" data-idx="' + idx + '" style="background:#F8FAFC;cursor:pointer" onclick="togglePayGroup(+this.dataset.idx)">' +
            '<td colspan="4" style="font-weight:700;padding:9px 12px">' +
            '<i class="fas fa-chevron-' + (isOpen?'down':'right') + '" style="font-size:9px;color:var(--muted);margin-right:6px"></i>' +
            escHTML(g.partyName) +
            ' <span style="font-weight:400;color:var(--muted);font-size:11px">(' + g.items.length + ' payment' + (g.items.length>1?'s':'') + ')</span>' +
            '</td>' +
            '<td class="num" style="font-weight:800;color:var(--green)">' + INR(g.total) + '</td>' +
            '<td colspan="3"></td></tr>' +
            (isOpen ? detailRows : '');
        }).join('');
      }

      let _pState_slab = { '15': 1, '1': 1, 'Nil': 1 };

      function slabPage(slab, d) {
        const key = slab === '15' ? '15' : slab === '1' ? '1' : 'Nil';
        const slabPct = key === '15' ? '1.5' : key === '1' ? '1' : '0';
        const filterFn = key === 'Nil'
          ? i => !isPaid(i) && (!i.slabPct || i.slabPct === '0')
          : i => !isPaid(i) && i.slabPct === slabPct;
        const total = (DB.invoices || []).filter(filterFn).length;
        _pState_slab[key] = Math.max(1, Math.min(_pState_slab[key] + d, Math.ceil(total / PER)));
        renderSlabDue(slab);
      }

      function calcExpected(inv) {
        // ALL calculations based on Bill Value (billValue), not netAmount
        const billVal = inv.billValue || inv.netAmount || 0;
        const tds = inv.tcs || 0;
        // Calculate all 3 slab discounts for display
        const disc15 = Math.round(billVal * 0.015);
        const disc1  = Math.round(billVal * 0.01);
        const discNil = 0;
        // Actual slab discount based on party's slab
        const pct  = inv.slabPct === '1.5' ? 0.015 : inv.slabPct === '1' ? 0.01 : 0;
        const disc = inv.slabPct === '1.5' ? disc15 : inv.slabPct === '1' ? disc1 : discNil;
        const expected = Math.max(0, billVal - tds - disc);
        // Expected amounts at each slab (for display reference)
        const exp15  = Math.max(0, billVal - tds - disc15);
        const exp1   = Math.max(0, billVal - tds - disc1);
        const expNil = Math.max(0, billVal - tds);
        return { netVal: billVal, billVal, tds, disc, disc15, disc1, discNil,
                 expected, exp15, exp1, expNil, pct };
      }

      function renderSlabDue(slab) {
        const isNil = slab === 'Nil';
        const key = slab === '15' ? '15' : slab === '1' ? '1' : 'Nil';
        const slabPct = key === '15' ? '1.5' : key === '1' ? '1' : '0';
        const prefix = isNil ? 'sNil' : 's' + key;

        const list = (DB.invoices || [])
          .filter(i => {
            const matchSlab = isNil
              ? (!isPaid(i) && (!i.slabPct || i.slabPct === '0'))
              : (!isPaid(i) && i.slabPct === slabPct);
            if (!matchSlab) return false;
            const fromEl = document.getElementById(prefix + '-from');
            const toEl = document.getElementById(prefix + '-to');
            const partyInpEl = document.getElementById(prefix + '-party-inp');
            const partyInpVal = partyInpEl ? partyInpEl.value.trim() : '';
            const partyEl = null; // replaced by text input
            const from = fromEl ? fromEl.value : '';
            const to = toEl ? toEl.value : '';
            const pf = partyInpVal ? ((DB.parties||[]).find(p=>p.name.toLowerCase()===partyInpVal.toLowerCase())||{}).partyID||'' : '';
            if (pf && i.partyID !== pf) return false;
            if (from || to) {
              const d = parseIST(i.invoiceDate);
              if (from && d && d < new Date(from)) return false;
              if (to && d && d > new Date(to + 'T23:59:59')) return false;
            }
            return true;
          })
          .sort((a, b) => (parseIST(a.dueDate) || 0) - (parseIST(b.dueDate) || 0));

        const totalExpected = list.reduce((s, i) => s + calcExpected(i).expected, 0);
        txt(prefix + '-sub', list.length + ' pending invoices');
        const badge = document.getElementById(prefix + '-total-badge');
        if (badge) badge.textContent = INR(totalExpected) + (isNil ? ' due' : ' expected');

        const total = list.length;
        const pg = _pState_slab[key];
        const page = list.slice((pg - 1) * PER, pg * PER);

        txt(prefix + '-info', `${((pg - 1) * PER) + 1}-${Math.min(pg * PER, total)} of ${total} invoices`);
        _updatePager(prefix, pg, total);

        const tbody = document.getElementById(prefix + '-tbody');
        if (!tbody) return;

        const accentColor = key === '15' ? '#34A853' : key === '1' ? '#F9AB00' : '#475569';

        tbody.innerHTML = page.length === 0
          ? emptyRow(isNil ? 9 : 10, 'No pending invoices for this slab')
          : page.map(inv => {
            const { netVal, billVal, tds, disc, expected, exp15, exp1, expNil } = calcExpected(inv);
            const od = daysOD(inv);
            const sts = od > 0 ? 'Overdue' : inv.paidAmount > 0 ? 'PartPaid' : 'Pending';
            return `<tr>
          <td style="font-family:monospace;font-size:11px;font-weight:600">${inv.invoiceNo}</td>
          <td style="cursor:pointer;font-size:12px;font-weight:600" onclick="openPartyModal('${escQ(inv.partyID)}')">${inv.partyName}</td>
          <td style="font-size:11px">${inv.invoiceDate}</td>
          <td style="font-size:11px${od > 0 ? ';color:var(--red);font-weight:700' : ''}">${inv.dueDate}${od > 0 ? ' ' + ageBadge(od) : ''}</td>
          <td class="num">${INR(netVal)}</td>
          <td class="num" style="color:var(--muted)">${tds > 0 ? '- ' + INR(tds) : '--'}</td>
          ${!isNil ? `<td class="num" style="color:${accentColor}">${disc > 0 ? '- ' + INR(disc) : '--'}</td>` : ''}
          <td class="num" style="padding:6px 8px"><div style="font-weight:800;font-size:13px;color:${accentColor}">${INR(expected)}</div><div style="font-size:10px;margin-top:3px;line-height:1.6"><div style="color:#1E8E3E;font-weight:600"><span style="background:#E6F4EA;border-radius:3px;padding:0 4px">1.5%</span> ${INR(exp15)}</div><div style="color:#F9AB00;font-weight:600"><span style="background:#FEF7E0;border-radius:3px;padding:0 4px">1%</span> ${INR(exp1)}</div><div style="color:#6B7280;font-weight:600"><span style="background:#F9FAFB;border-radius:3px;padding:0 4px">Nil</span> ${INR(expNil)}</div></div></td>
          <td>${statusBadge(sts)}</td>
          <td style="white-space:nowrap;text-align:right">
            <button class="act-btn ab-edit admin-only" onclick="openEditInvoiceModal('${escQ(inv.invoiceID)}')" title="Edit Invoice"><i class="fas fa-edit"></i></button>
            <button class="act-btn ab-fu" onclick="openFUModalForParty('${escQ(inv.partyID)}','${escQ(inv.invoiceNo)}')" title="Log Follow-up"><i class="fas fa-phone-alt"></i></button>
            <button class="act-btn ab-pay" onclick="openRPModalForParty('${escQ(inv.partyID)}')" title="Record Payment"><i class="fas fa-indian-rupee-sign"></i></button>
          </td>
        </tr>`;
          }).join('');
      }

function shortPage(d) {
        const list = _getShortPayList();
        _pState.shortpay = Math.max(1, Math.min(_pState.shortpay + d, Math.ceil(list.length / PER)));
        renderShortPay();
      }

      // Helper: get total discount given for an invoice from payments
      function _discForInvoice(invoiceNo) {
        // Use word-boundary match to avoid partial invoice number matches
        const re = new RegExp('(^|,\s*)' + invoiceNo.replace(/[-]/g, '\\$&') + '(\s*,|$)');
        return (DB.payments || [])
          .filter(p => p.appliedTo && re.test(p.appliedTo))
          .reduce((s, p) => s + (p.discountGiven || 0), 0);
      }

      // Short payment: party paid less than expected (billValue - TDS - slabDisc)
      function _tdsForInvoice(invoiceNo) {
        // Sum TDS from all payment records applied to this invoice
        const re = new RegExp('(^|,\s*)' + invoiceNo.replace(/[-]/g, '\\$&') + '(\s*,|$)');
        return (DB.payments || [])
          .filter(p => p.appliedTo && re.test(p.appliedTo))
          .reduce((s, p) => s + (p.tdsDeducted || 0), 0);
      }

      function _isShortPay(inv) {
        if (isPaid(inv)) return false;
        const paidAmt = inv.paidAmount || 0;
        if (paidAmt <= 0) return false; // never paid — not short, just unpaid
        const writeOff  = inv.writeOff || 0;
        const discGiven = _discForInvoice(inv.invoiceNo);
        const tdsPaid   = _tdsForInvoice(inv.invoiceNo);
        // expected = billValue - invoiceTDS - slabDisc (calcExpected handles this)
        const { expected } = calcExpected(inv);
        // Short if total settlement < expected
        return (paidAmt + tdsPaid + discGiven + writeOff) < expected;
      }

      function _getShortPayList() {
        const q = ((document.getElementById('sp-search') || {}).value || '').toLowerCase();
        const from = (document.getElementById('sp-from') || {}).value || '';
        const to = (document.getElementById('sp-to') || {}).value || '';

        return (DB.invoices || []).filter(inv => {
          if (!_isShortPay(inv)) return false;
          if (q && !inv.partyName.toLowerCase().includes(q) && !inv.invoiceNo.toLowerCase().includes(q)) return false;
          if (from || to) {
            const d = parseIST(inv.invoiceDate);
            if (from && d && d < new Date(from)) return false;
            if (to && d && d > new Date(to + 'T23:59:59')) return false;
          }
          return true;
        }).sort((a, b) => (parseIST(b.invoiceDate) || 0) - (parseIST(a.invoiceDate) || 0));
      }

      function renderShortPay() {
        const list = _getShortPayList();
        const total = list.length;
        const pg = _pState.shortpay;
        const page = list.slice((pg - 1) * PER, pg * PER);

        const totalShort = list.reduce((s, inv) => {
          const paidAmt   = inv.paidAmount || 0;
          const discGiven = _discForInvoice(inv.invoiceNo);
          const tdsPaid   = _tdsForInvoice(inv.invoiceNo);
          const writeOff  = inv.writeOff || 0;
          const { expected } = calcExpected(inv);
          return s + Math.max(0, expected - paidAmt - tdsPaid - discGiven - writeOff);
        }, 0);

        txt('sp-sub', total + ' invoices with short payment');
        const badge = document.getElementById('sp-total-badge');
        if (badge) badge.textContent = INR(totalShort) + ' short';

        txt('sp-info', `${((pg - 1) * PER) + 1}-${Math.min(pg * PER, total)} of ${total} invoices`);
        _updatePager('sp', pg, total);

        const tbody = document.getElementById('sp-tbody');
        if (!tbody) return;

        tbody.innerHTML = page.length === 0
          ? emptyRow(9, '[OK] No short payments -- all good!')
          : page.map(inv => {
            const { expected } = calcExpected(inv);
            const paidAmt   = inv.paidAmount || 0;
            const writeOff  = inv.writeOff || 0;
            const discGiven = _discForInvoice(inv.invoiceNo);
            const tdsPaid   = _tdsForInvoice(inv.invoiceNo);
            const shortAmt  = Math.max(0, expected - paidAmt - tdsPaid - discGiven - writeOff);
            const od = daysOD(inv);
            return `<tr style="${shortAmt > 0 ? 'background:#FEF7E0' : ''}">
          <td style="font-family:monospace;font-size:11px;font-weight:600">${inv.invoiceNo}</td>
          <td style="font-size:12px;font-weight:600;cursor:pointer" onclick="openPartyModal('${escQ(inv.partyID)}')">${inv.partyName}</td>
          <td style="font-size:11px${od > 0 ? ';color:var(--red);font-weight:700' : ''}">${inv.dueDate}${od > 0 ? ' ' + ageBadge(od) : ''}</td>
          <td class="num" style="color:#34A853;font-weight:700">${INR(expected)}</td>
          <td class="num" style="color:var(--green)">${INR(paidAmt)}</td>
          <td class="num" style="color:#7C3AED">${discGiven > 0 ? INR(discGiven) : '--'}</td>
          <td class="num" style="font-weight:800;color:var(--red);font-size:13px">- ${INR(shortAmt)}</td>
          <td>${statusBadge('PartPaid')}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-sm" onclick="openEditInvoiceModal('${escQ(inv.invoiceID)}')" title="Edit Invoice" style="background:#F5F3FF;color:#7C3AED;border:1px solid #DDD6FE" class="admin-only"><i class="fas fa-edit" style="font-size:10px"></i></button>
            <button class="btn btn-sm btn-amber" onclick="openFUModalForParty('${escQ(inv.partyID)}','${escQ(inv.invoiceNo)}')" title="Log Follow-up why short"><i class="fas fa-phone-alt" style="font-size:10px"></i></button>
            <button class="btn btn-sm btn-green" onclick="openRPModalForParty('${escQ(inv.partyID)}')" title="Record remaining payment"><i class="fas fa-indian-rupee-sign" style="font-size:10px"></i></button>
            ${window._isAdmin ? `<button class="btn btn-sm" onclick="openWriteOffModal('${escQ(inv.invoiceID)}','${escQ(inv.invoiceNo)}',${Math.round(shortAmt)})" title="Write-Off" style="background:#F3F4F6;color:#6B7280;border:1px solid #E5E7EB;font-size:10px"><i class="fas fa-times-circle" style="font-size:10px"></i></button>` : ''}
          </td>
        </tr>`;
          }).join('');
      }

      function latePage(d) {
        const list = _getLatePayList();
        _pState.latepay = Math.max(1, Math.min(_pState.latepay + d, Math.ceil(list.length / PER)));
        renderLatePay();
      }

      function _getLatePayList() {
        const q = ((document.getElementById('lp-search') || {}).value || '').toLowerCase();
        const from = (document.getElementById('lp-from') || {}).value || '';
        const to = (document.getElementById('lp-to') || {}).value || '';

        const paidInvoices = (DB.invoices || []).filter(i => isPaid(i));
        const result = [];

        paidInvoices.forEach(inv => {
          const invPayments = (DB.payments || []).filter(p =>
            p.appliedTo && p.appliedTo.includes(inv.invoiceNo)
          );
          if (!invPayments.length) return;

          const payDates = invPayments.map(p => parseIST(p.paymentDate)).filter(Boolean);
          const firstPayDate = payDates.length ? new Date(Math.min(...payDates.map(d => d.getTime()))) : null;
          if (!firstPayDate) return;

          const dueDate = parseIST(inv.dueDate);
          if (!dueDate) return;

          const daysLate = Math.floor((firstPayDate - dueDate) / 86400000);
          if (daysLate <= 0) return; // not late

          if (from && firstPayDate < new Date(from)) return;
          if (to && firstPayDate > new Date(to + 'T23:59:59')) return;

          if (q && !inv.partyName.toLowerCase().includes(q)) return;

          const slabLost = inv.slabPct && inv.slabPct !== '0';

          result.push({
            inv, firstPayDate, daysLate, slabLost,
            payDateStr: firstPayDate.getDate().toString().padStart(2, '0') + '/' +
              (firstPayDate.getMonth() + 1).toString().padStart(2, '0') + '/' +
              firstPayDate.getFullYear()
          });
        });

        return result.sort((a, b) => b.daysLate - a.daysLate); // worst offenders first
      }

      let _lpSort = { col: 'maxDays', dir: -1 };
      function setLPSort(col) {
        if (_lpSort.col === col) _lpSort.dir *= -1; else { _lpSort.col = col; _lpSort.dir = -1; }
        window._lpExpanded = {}; // reset on sort
        renderLatePay();
      }
      // Late pay group clicks handled via direct onclick on tr
      function _lpSortIcon(col) {
        if (_lpSort.col !== col) return ' <i class="fas fa-sort" style="opacity:.25;font-size:10px"></i>';
        return _lpSort.dir === -1
          ? ' <i class="fas fa-sort-down" style="font-size:10px;color:var(--red)"></i>'
          : ' <i class="fas fa-sort-up" style="font-size:10px;color:var(--red)"></i>';
      }
      function renderLatePay() {
        const list = _getLatePayList();
        const total = list.length;
        const pg = _pState.latepay;
        
        // Group by Party
        const grouped = {};
        list.forEach(item => {
          const pid = item.inv.partyID;
          if (!grouped[pid]) {
            grouped[pid] = { 
              partyName: item.inv.partyName, 
              partyID: item.inv.partyID,
              count: 0, 
              totalLateDays: 0, 
              maxLateDays: 0,
              totalAmt: 0,
              items: [] 
            };
          }
          grouped[pid].count++;
          grouped[pid].totalLateDays += item.daysLate;
          grouped[pid].maxLateDays = Math.max(grouped[pid].maxLateDays, item.daysLate);
          grouped[pid].totalAmt += item.inv.netAmount;
          grouped[pid].items.push(item);
        });

        const groupedList = Object.values(grouped).sort((a, b) => {
          let av, bv;
          if (_lpSort.col === 'party') { av = a.partyName||''; bv = b.partyName||''; }
          else if (_lpSort.col === 'count') { av = a.count; bv = b.count; }
          else if (_lpSort.col === 'amt') { av = a.totalAmt; bv = b.totalAmt; }
          else { av = a.maxLateDays; bv = b.maxLateDays; } // maxDays default
          if (av < bv) return -1 * _lpSort.dir;
          if (av > bv) return 1 * _lpSort.dir;
          return 0;
        });
        const totalGroups = groupedList.length;
        const page = groupedList.slice((pg - 1) * PER, pg * PER);

        txt('lp-sub', total + ' late invoices across ' + totalGroups + ' parties');
        const badge = document.getElementById('lp-total-badge');
        if (badge) badge.textContent = totalGroups + ' parties';

        txt('lp-info', `${((pg - 1) * PER) + 1}-${Math.min(pg * PER, totalGroups)} of ${totalGroups} parties`);
        _updatePager('lp', pg, totalGroups);

        const tbody = document.getElementById('lp-tbody');
        if (!tbody) return;
        const lpThead = document.getElementById('lp-thead');
        if (lpThead) lpThead.innerHTML = `<tr>
          <th style="cursor:pointer;user-select:none" onclick="setLPSort('party')">Party${_lpSortIcon('party')}</th>
          <th class="num" style="cursor:pointer;user-select:none" onclick="setLPSort('maxDays')">Avg/Max Late${_lpSortIcon('maxDays')}</th>
          <th class="num" style="cursor:pointer;user-select:none" onclick="setLPSort('amt')">Invoice Amt${_lpSortIcon('amt')}</th>
          <th style="cursor:pointer;user-select:none" onclick="setLPSort('count')">Count${_lpSortIcon('count')}</th>
          <th></th>
        </tr>`;

        let _lpExp = window._lpExpanded || {}; window._lpExpanded = _lpExp;
        tbody.innerHTML = page.length === 0
          ? emptyRow(6, '[OK] No late payments found')
          : page.map((group, idx) => {
            const avgLate = Math.round(group.totalLateDays / group.count);
            const lateColor = group.maxLateDays > 30 ? 'var(--red)' : group.maxLateDays > 15 ? '#F9AB00' : '#EA8600';
            const isOpen = _lpExp[idx] !== false;
            return `
        <tr class="lp-group-hdr" data-idx="${idx}" data-isopen="${isOpen?'1':'0'}" style="background:#F8FAFC;cursor:pointer" onclick="toggleLPGroup(this)">
          <td colspan="4" style="font-weight:700">
            <i class="fas fa-chevron-${isOpen?'down':'right'}" style="margin-right:8px;font-size:10px;color:var(--muted)"></i>
            ${group.partyName}
            <span style="font-weight:400;color:var(--muted);margin-left:8px">(${group.count} late bills)</span>
          </td>
          <td class="num" style="font-weight:800;color:${lateColor}">Avg: ${avgLate}d / Max: ${group.maxLateDays}d</td>
          <td class="num" style="font-weight:700">${INR(group.totalAmt)}</td>
          <td></td>
          <td>
            <button class="btn btn-sm btn-amber" onclick="event.stopPropagation();openFUModalForParty('${escQ(group.partyID)}','')" title="Follow up"><i class="fas fa-phone-alt"></i></button>
          </td>
        </tr>
        ${group.items.map(item => `
          <tr style="font-size:11px;opacity:0.85">
            <td style="padding-left:30px;color:var(--muted)">- ${item.inv.invoiceNo}</td>
            <td style="color:var(--muted)">Due: ${item.inv.dueDate}</td>
            <td style="color:var(--muted)">Paid: ${item.payDateStr}</td>
            <td class="num" style="color:${item.daysLate > 15 ? 'var(--red)' : 'inherit'}">${item.daysLate}d late</td>
            <td class="num">${INR(item.inv.netAmount)}</td>
            <td colspan="3"></td>
          </tr>
        `).join('')}
      `;
          }).join('');
      }

      let _modalPartyID = '';
      function openPartyModal(partyID) {
        _modalPartyID = partyID;
        const p = (DB.parties || []).find(x => x.partyID === partyID);
        if (!p) return;

        const invList = (DB.invoices || []).filter(i => i.partyID === partyID && !isPaid(i));
        const fuList = [...(DB.followups || []).filter(f => f.partyID === partyID)].reverse().slice(0, 8);
        const totalOut = invList.reduce((s, i) => s + pending(i), 0);

        txt('pm-name', p.name);
        document.getElementById('pm-name').innerHTML = p.name + (p.rating ? renderStars(p.rating) : '');
        txt('pm-sub', [p.city, p.head].filter(v => v && v !== '--').join('  ') || '--');
        txt('pm-out', INR(totalOut));
        txt('pm-phone', p.phone || '--');
        txt('pm-cat', p.category || '--');

        const slab = p.days15 ? '1.5% (' + p.days15 + 'd)' : p.days1 ? '1% (' + p.days1 + 'd)' : 'Nil (' + p.days0 + 'd)';
        document.getElementById('pm-slab').innerHTML = `<span class="${p.days15 ? 'slab-15' : p.days1 ? 'slab-1' : 'slab-0'}">${slab}</span>`;

        document.getElementById('pm-invoices').innerHTML = invList.length === 0
          ? '<div style="font-size:11px;color:var(--muted);padding:8px">No pending invoices</div>'
          : invList.map(i => {
            const od = daysOD(i);
            const pend = pending(i);
            const { expected, exp15, exp1, expNil, billVal } = calcExpected(i);
            const hasSlab = i.slabPct && i.slabPct !== '0';
            return `
      <div style="background:#F8FAFC;border-radius:8px;padding:9px 12px;border:1px solid ${od > 0 ? '#F6AEA9' : 'var(--border)'}">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-size:11px;font-weight:700;font-family:monospace">${i.invoiceNo}</span>
              ${slabBadge(i.slabPct)}
              ${od > 0 ? ageBadge(od) : ''}
            </div>
            <div style="font-size:10px;color:var(--muted);margin-top:2px">
              Due: ${i.dueDate}
              ${hasSlab ? `<span style="color:#34A853;font-weight:600;margin-left:6px">Exp: ${INR(expected)}</span>` : ''}
            </div>
            <div style="font-size:9px;color:var(--muted);margin-top:3px">
              Bill: <b>${INR(billVal)}</b>
              &nbsp;<span style="color:#1E8E3E">1.5%→${INR(exp15)}</span>
              &nbsp;<span style="color:#F9AB00">1%→${INR(exp1)}</span>
              &nbsp;<span style="color:#6B7280">Nil→${INR(expNil)}</span>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
            <div style="text-align:right">
              <div style="font-size:13px;font-weight:800;${od > 0 ? 'color:var(--red)' : 'color:var(--text)'}">${INR(pend)}</div>
            </div>
            
            <button class="btn btn-sm btn-green" title="Record payment for this invoice"
              onclick="closePartyModal();openRPModalForPartyAndInvoice('${escQ(_modalPartyID)}',${Math.round(expected) || Math.round(pend)})"
              style="font-size:10px;padding:4px 8px">
              <i class="fas fa-indian-rupee-sign"></i>
            </button>
            ${window._isAdmin ? `
            <button class="btn btn-sm btn-ghost" title="Write-off & close"
              onclick="confirmCloseInvoice('${escQ(i.invoiceID)}','${escQ(i.invoiceNo)}','${escQ(_modalPartyID)}')"
              style="color:#94A3B8;border-color:#E2E8F0;width:28px;height:28px;padding:0;flex-shrink:0">
              <i class="fas fa-times-circle" style="font-size:12px"></i>
            </button>` : ''}
          </div>
        </div>
      </div>`;
          }).join('');

        document.getElementById('pm-followups').innerHTML = fuList.length === 0
          ? '<div style="font-size:11px;color:var(--muted);padding:8px">No follow-ups logged</div>'
          : fuList.map(f => {
            const bg = modeBg(f.mode);
            return `<div style="display:flex;align-items:flex-start;gap:8px;padding:7px 0;border-bottom:1px solid #F8FAFC">
          <div style="width:24px;height:24px;border-radius:50%;background:${bg.split(';')[0]};display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px">
            <i class="fas ${modeIcon(f.mode)}" style="font-size:9px;color:${bg.split(':')[1]}"></i>
          </div>
          <div style="flex:1;min-width:0">
            <div style="font-size:11px;font-weight:600">${(f.datetime || '').split(' ')[0]}  ${f.mode}</div>
            <div style="font-size:11px;color:var(--muted);overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${f.notes}</div>
            ${f.promiseDate ? `<div style="font-size:10px;color:var(--amber)">Promise: ${INR(f.promiseAmt)} by ${f.promiseDate}</div>` : ''}
          </div>
        </div>`;
          }).join('');

        // Populate Write-Off / Discount Given section
        const partyPaymentsDisc = (DB.payments || []).filter(p => p.partyID === partyID && (p.discountGiven || 0) > 0);
        const partyDTBG = (DB.payments || []).filter(p => p.partyID === partyID && (p.discountToBeGiven || 0) > 0);
        const woInvoices = (DB.invoices || []).filter(i => i.partyID === partyID && (i.status === 'Written-Off' || (i.writeOff || 0) > 0));

        // DTBG section
        const dtbgSec = document.getElementById('pm-dtbg-section');
        if (dtbgSec) dtbgSec.style.display = partyDTBG.length > 0 ? 'block' : 'none';
        const pmDtbgEl = document.getElementById('pm-dtbg');
        if (pmDtbgEl) pmDtbgEl.innerHTML = partyDTBG.length === 0 ? '' : partyDTBG.map(p =>
          `<div style="background:#F5F3FF;border-radius:7px;padding:7px 10px;border:1px solid #DDD6FE;display:flex;justify-content:space-between">
            <div><span style="font-size:11px;font-weight:700;color:#7C3AED">Pending Discount</span>
            <div style="font-size:10px;color:var(--muted)">${p.paymentDate} · ${p.paymentID}</div></div>
            <span style="font-weight:800;color:#7C3AED">${INR(p.discountToBeGiven)}</span>
          </div>`
        ).join('');

        // WO section
        const woSec = document.getElementById('pm-wo-section');
        const hasWO = partyPaymentsDisc.length > 0 || woInvoices.length > 0;
        if (woSec) woSec.style.display = hasWO ? 'block' : 'none';
        const pmWoEl = document.getElementById('pm-wo');
        if (pmWoEl) pmWoEl.innerHTML = !hasWO ? '' : [
          ...partyPaymentsDisc.map(p => `<div style="background:#E6F4EA;border-radius:7px;padding:7px 10px;border:1px solid #A7F3D0;display:flex;justify-content:space-between">
            <div><span style="font-size:11px;font-weight:700;color:#1E8E3E">Discount Given</span>
            <div style="font-size:10px;color:var(--muted)">${p.paymentDate} · ${p.appliedTo||'--'}</div></div>
            <span style="font-weight:800;color:#1E8E3E">${INR(p.discountGiven)}</span>
          </div>`),
          ...woInvoices.map(i => `<div style="background:#FEF3C7;border-radius:7px;padding:7px 10px;border:1px solid #FDD663;display:flex;justify-content:space-between">
            <div><span style="font-size:11px;font-weight:700;color:#F9AB00">Written-Off</span>
            <div style="font-size:10px;color:var(--muted)">${i.invoiceNo} · ${i.dueDate}</div></div>
            <span style="font-weight:800;color:#F9AB00">${INR(i.writeOff||0)}</span>
          </div>`)
        ].join('');

        document.getElementById('party-modal').classList.add('show');
      }

      function closePartyModal() { document.getElementById('party-modal').classList.remove('show'); }
      function prefillFU() { closePartyModal(); openFUModalForParty(_modalPartyID, ''); }
      function prefillRP() { closePartyModal(); openRPModalForParty(_modalPartyID); }

      function openRPModalForPartyAndInvoice(partyID, amount) {
        openRPModal();
        setTimeout(() => {
          const p = (DB.parties || []).find(x => x.partyID === partyID);
          if (!p) return;
          document.getElementById('rp-party-id').value = p.partyID;
          document.getElementById('rp-party-code').value = p.partyCode || '';
          document.getElementById('rp-party-name').value = p.name;
          const inp = document.getElementById('rp-modal-ss-inp');
          if (inp) inp.value = p.name;
          if (_ssState['rp-modal-ss']) { _ssState['rp-modal-ss'].value = p.partyID; _ssState['rp-modal-ss'].text = p.name; }
          const amtEl = document.getElementById('rp-amount');
          if (amtEl && amount > 0) {
            amtEl.value = amount;
            amtEl.style.borderColor = '#34A853';
            amtEl.style.background = '#E6F4EA';
            setTimeout(() => { amtEl.style.borderColor = ''; amtEl.style.background = ''; }, 2000);
          }
          onRPParty(partyID);
        }, 120);
      }

      function openWriteOffModal(invoiceID, invoiceNo, shortAmt) {
        Swal.fire({
          title: 'Write-Off: ' + invoiceNo,
          html: `<div style="font-size:13px;color:#64748B;margin-bottom:10px">
            Short amount: <b style="color:var(--red)">₹${shortAmt.toLocaleString('en-IN')}</b><br>
            Write this off and close the invoice?
          </div>
          <input id="swal-wo-amt" class="swal2-input" type="number" value="${Math.round(shortAmt)}" placeholder="Write-off amount" style="font-size:13px">
          <input id="swal-wo-reason" class="swal2-input" placeholder="Reason (e.g. Short/Settlement)" style="font-size:13px">`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: '<i class="fas fa-times-circle"></i> Write-Off',
          cancelButtonText: 'Cancel',
          confirmButtonColor: '#EA4335',
          preConfirm: () => {
            const amt = parseFloat(document.getElementById('swal-wo-amt').value);
            const reason = document.getElementById('swal-wo-reason').value.trim();
            if (!amt || amt <= 0) { Swal.showValidationMessage('Enter valid amount'); return false; }
            if (!reason) { Swal.showValidationMessage('Enter a reason'); return false; }
            return { amt, reason };
          }
        }).then(result => {
          if (!result.isConfirmed) return;
          Swal.fire({ title: 'Processing...', didOpen: () => Swal.showLoading(), background: '#0F172A', color: '#fff' });
          google.script.run
            .withSuccessHandler(r => {
              if (r.success) {
                Swal.fire({ icon: 'success', title: 'Written Off', text: r.msg, timer: 2500, showConfirmButton: false });
                _silentDataRefresh();
              } else Swal.fire('Error', r.error, 'error');
            })
            .withFailureHandler(e => Swal.fire('Error', e.message, 'error'))
            .writeOffInvoice(invoiceID, result.value.amt, result.value.reason, URL_NAME);
        });
      }

      function confirmCloseInvoice(invoiceID, invoiceNo, partyID) {
        Swal.fire({
          title: 'Close Invoice ' + invoiceNo + '?',
          html: `<div style="font-size:13px;color:#64748B;margin-bottom:12px">
      Close invoice <b>${invoiceNo}</b> - mark as settled.<br>
      Use for write-offs, settlements, or discount adjustments.
    </div>
    <input id="swal-reason" class="swal2-input" placeholder="Reason (e.g. Write-off, Settlement)" style="font-size:13px">`,
          icon: 'warning',
          showCancelButton: true,
          confirmButtonText: '<i class="fas fa-times-circle"></i> Close Invoice',
          cancelButtonText: 'Cancel',
          confirmButtonColor: '#EA4335',
          preConfirm: () => {
            const reason = document.getElementById('swal-reason').value.trim();
            if (!reason) { Swal.showValidationMessage('Please enter a reason'); return false; }
            return reason;
          }
        }).then(result => {
          if (!result.isConfirmed) return;
          Swal.fire({ title: 'Closing...', didOpen: () => Swal.showLoading(), background: '#0F172A', color: '#fff' });
          google.script.run
            .withSuccessHandler(r => {
              if (r.success) {
                Swal.fire({ icon: 'success', title: 'Invoice Closed', text: r.msg, timer: 2500, showConfirmButton: false });
                closePartyModal();
                _silentDataRefresh();
              } else {
                Swal.fire('Error', r.error, 'error');
              }
            })
            .withFailureHandler(e => Swal.fire('Error', e.message, 'error'))
            .closeInvoice(invoiceID, result.value, URL_NAME);
        });
      }

      function resetPartyForm() {
        ['ap-code', 'ap-name', 'ap-city', 'ap-state', 'ap-phone', 'ap-phone2', 'ap-email', 'ap-contact',
          'ap-gstin', 'ap-pan', 'ap-head', 'ap-credit', 'ap-d15', 'ap-d1', 'ap-d0', 'ap-terms',
          'ap-address', 'ap-tags', 'ap-notes'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
        const cat = document.getElementById('ap-cat'); if (cat) cat.value = 'B';
      }

      function submitParty() {
        const name = (document.getElementById('ap-name').value || '').trim();
        const code = (document.getElementById('ap-code').value || '').trim();
        if (!name) { Swal.fire('Required', 'Party name is required', 'warning'); return; }
        if (!code) { Swal.fire('Required', 'Party code is required', 'warning'); return; }

        const data = {
          partyCode: code,
          name, city: document.getElementById('ap-city').value,
          state: document.getElementById('ap-state').value,
          phone: document.getElementById('ap-phone').value,
          phone2: document.getElementById('ap-phone2').value,
          email: document.getElementById('ap-email').value,
          contact: document.getElementById('ap-contact').value,
          gstin: document.getElementById('ap-gstin').value,
          pan: document.getElementById('ap-pan').value,
          head: document.getElementById('ap-head').value,
          creditLimit: document.getElementById('ap-credit').value,
          days15: document.getElementById('ap-d15').value || null,
          days1: document.getElementById('ap-d1').value || null,
          days0: document.getElementById('ap-d0').value || null,
          payTerms: document.getElementById('ap-terms').value,
          category: document.getElementById('ap-cat').value,
          address: document.getElementById('ap-address').value,
          tags: document.getElementById('ap-tags').value,
          notes: document.getElementById('ap-notes').value,
          status: 'Active'
        };

        Swal.fire({ title: 'Saving...', didOpen: () => Swal.showLoading(), background: '#0F172A', color: '#fff' });
        google.script.run
          .withSuccessHandler(r => {
            if (r.success) {
              Swal.fire({ icon: 'success', title: 'Party Created!', text: r.msg, timer: 2000, showConfirmButton: false });
              resetPartyForm();
              _silentDataRefresh();
              setTimeout(() => nav('parties'), 1800);
            } else Swal.fire('Error', r.error, 'error');
          })
          .withFailureHandler(e => Swal.fire('Error', e.message, 'error'))
          .createParty(data, URL_NAME);
      }

      function onAIParty(partyID) {
        const p = (DB.parties || []).find(x => x.partyID === partyID);
        if (!p) return;
        const box = document.getElementById('ai-slab-box');
        const inf = document.getElementById('ai-slab-info');
        const slabSel = document.getElementById('ai-slab');
        const parts = [];
        if (p.days15) parts.push(`1.5% = ${p.days15} days`);
        if (p.days1) parts.push(`1% = ${p.days1} days`);
        if (p.days0) parts.push(`Nil = ${p.days0} days`);
        inf.textContent = parts.join('  ') || 'No slab configured';
        box.style.display = 'flex';
        if (p.days15) slabSel.value = '1.5';
        else if (p.days1) slabSel.value = '1';
        else slabSel.value = '0';
        calcDue();
      }

      function calcDue() {
        const partyID = document.getElementById('ai-party-id').value;
        const slab = document.getElementById('ai-slab').value;
        const dateVal = document.getElementById('ai-invdate').value;
        if (!partyID || !slab || !dateVal) return;

        const p = (DB.parties || []).find(x => x.partyID === partyID);
        if (!p) return;

        let days = p.days0 || 30;
        if (slab === '1.5' && p.days15) days = p.days15;
        else if (slab === '1' && p.days1) days = p.days1;
        else if (slab === '0' && p.days0) days = p.days0;

        const bd = new Date(dateVal);
        const dd = new Date(bd); dd.setDate(dd.getDate() + days);
        const str = String(dd.getDate()).padStart(2, '0') + '/' + String(dd.getMonth() + 1).padStart(2, '0') + '/' + dd.getFullYear();

        document.getElementById('ai-duedate-disp').textContent = str + ' (' + days + ' days)';
        document.getElementById('ai-duedate').value = str;
        document.getElementById('ai-duedays').value = days;
      }

      function calcNet() {
        const gross = parseFloat(document.getElementById('ai-gross').value) || 0;
        const cgst = parseFloat(document.getElementById('ai-cgst').value) || 0;
        const sgst = parseFloat(document.getElementById('ai-sgst').value) || 0;
        const igst = parseFloat(document.getElementById('ai-igst').value) || 0;
        const tcs = parseFloat(document.getElementById('ai-tcs').value) || 0;
        const other = parseFloat(document.getElementById('ai-other').value) || 0;
        const cd = parseFloat(document.getElementById('ai-cd-disc').value) || 0;
        const net = gross - cgst - sgst - igst - tcs - other - cd;
        const box = document.getElementById('ai-net-box');
        const val = document.getElementById('ai-net-val');
        if (gross > 0) {
          box.style.display = 'flex';
          val.textContent = INR(net);
          val.style.color = net >= 0 ? 'var(--green)' : 'var(--red)';
        } else {
          box.style.display = 'none';
        }
      }

      function resetInvoiceForm() {
        ['ai-invno', 'ai-vehicle', 'ai-head', 'ai-remarks'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
        ['ai-party-id', 'ai-party-code', 'ai-party-name', 'ai-duedate', 'ai-duedays'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
        ['ai-gross', 'ai-cgst', 'ai-sgst', 'ai-igst', 'ai-tcs', 'ai-other', 'ai-cd-disc'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
        const s = document.getElementById('ai-slab'); if (s) s.value = '';
        const b = document.getElementById('ai-slab-box'); if (b) b.style.display = 'none';
        const n = document.getElementById('ai-net-box'); if (n) n.style.display = 'none';
        document.getElementById('ai-duedate-disp').textContent = '--';
        const inp = document.getElementById('ai-ss-inp'); if (inp) inp.value = '';
        if (_ssState['ai-ss']) { _ssState['ai-ss'].value = ''; _ssState['ai-ss'].text = ''; }
      }

      function submitInvoice() {
        const partyID = document.getElementById('ai-party-id').value;
        const partyName = document.getElementById('ai-party-name').value;
        const invoiceNo = (document.getElementById('ai-invno').value || '').trim();
        const invDate = document.getElementById('ai-invdate').value;
        const slab = document.getElementById('ai-slab').value;
        const dueDate = document.getElementById('ai-duedate').value;
        const gross = parseFloat(document.getElementById('ai-gross').value) || 0;

        if (!partyID) { Swal.fire('Required', 'Select a party first', 'warning'); return; }
        if (!invoiceNo) { Swal.fire('Required', 'Invoice number is required', 'warning'); return; }
        if (!invDate) { Swal.fire('Required', 'Invoice date is required', 'warning'); return; }
        if (!slab) { Swal.fire('Required', 'Select a slab', 'warning'); return; }
        if (!gross) { Swal.fire('Required', 'Bill Value is required', 'warning'); return; }

        const cgst = parseFloat(document.getElementById('ai-cgst').value) || 0;
        const sgst = parseFloat(document.getElementById('ai-sgst').value) || 0;
        const igst = parseFloat(document.getElementById('ai-igst').value) || 0;
        const tcs = parseFloat(document.getElementById('ai-tcs').value) || 0;
        const other = parseFloat(document.getElementById('ai-other').value) || 0;
        const cd = parseFloat(document.getElementById('ai-cd-disc').value) || 0;
        const net = gross - cgst - sgst - igst - tcs - other - cd;

        const fmtDate = d => {
          const dt = new Date(d);
          return String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0') + '/' + dt.getFullYear();
        };

        const data = {
          partyID, partyName,
          partyCode: document.getElementById('ai-party-code').value,
          invoiceNo,
          invoiceDate: fmtDate(invDate),
          dueDate: dueDate || fmtDate(invDate),
          dueDays: parseInt(document.getElementById('ai-duedays').value) || 0,
          slabPct: slab,
          billValue: gross, cgst, sgst, igst, tcs, otherDed: other, discountGiven: parseFloat(document.getElementById("ai-cd-disc").value)||0,
          netAmount: net,
          vehicleNo: document.getElementById('ai-vehicle').value,
          head: document.getElementById('ai-head').value,
          remarks: document.getElementById('ai-remarks').value
        };

        Swal.fire({ title: 'Saving...', didOpen: () => Swal.showLoading(), background: '#0F172A', color: '#fff' });
        google.script.run
          .withSuccessHandler(r => {
            if (r.success) {
              Swal.fire({ icon: 'success', title: 'Invoice Saved!', text: r.msg, timer: 2000, showConfirmButton: false });
              resetInvoiceForm();
              _silentDataRefresh();
              setTimeout(() => nav('invoices'), 1800);
            } else Swal.fire('Error', r.error, 'error');
          })
          .withFailureHandler(e => Swal.fire('Error', e.message, 'error'))
          .createInvoice(data, URL_NAME);
      }

      function onRPParty(partyID) {
        const bills = (DB.invoices || []).filter(i => i.partyID === partyID && !isPaid(i))
          .sort((a, b) => (parseIST(a.invoiceDate) || 0) - (parseIST(b.invoiceDate) || 0));
        const box = document.getElementById('rp-bills-box');
        const list = document.getElementById('rp-bills-list');
        if (!bills.length) { box.style.display = 'none'; return; }
        box.style.display = 'block';

        list.innerHTML = bills.map(inv => {
          const od = daysOD(inv);
          const pend = pending(inv);
          const { netVal, billVal, tds, disc, disc15, disc1, expected, exp15, exp1, expNil, pct } = calcExpected(inv);
          const discLabel = pct > 0 ? (pct * 100) + '% disc' : '';
          const borderClr = od > 0 ? '#F6AEA9' : '#E2E8F0';

          return `<div style="background:#F8FAFC;border-radius:8px;padding:10px 12px;border:1.5px solid ${borderClr};display:flex;gap:12px;transition:all .15s" class="rp-inv-row">
            <div style="padding-top:2px">
              <input type="checkbox" class="rp-inv-check" value="${inv.invoiceNo}" 
                data-expected="${Math.round(pend)}" data-billtotal="${Math.round(billVal)}" data-expected-disc="${Math.round(expected)}" 
                onchange="updateRPSummary()" style="width:18px;height:18px;cursor:pointer">
            </div>
            <div style="flex:1;cursor:pointer" onclick="this.previousElementSibling.querySelector('input').click()">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
                <div>
                  <div style="font-size:11px;font-weight:700;font-family:monospace">${inv.invoiceNo}</div>
                  <div style="font-size:10px;color:var(--muted)">Bill: ${inv.invoiceDate}&nbsp;&nbsp;|&nbsp;&nbsp;Due: ${inv.dueDate} ${od > 0 ? ageBadge(od) : ''}</div>
                </div>
                <div style="text-align:right">
                  ${inv.paidAmount > 0 ? `<div style="font-size:10px;color:#1E8E3E;font-weight:600">Paid: ${INR(inv.paidAmount)}</div>` : ''}
                  <div style="font-size:13px;font-weight:800;color:${pend > 0 ? 'var(--red)' : '#1E8E3E'}">${INR(pend > 0 ? pend : billVal)}</div>
                  <div style="font-size:9px;color:var(--muted);font-weight:500">${pend > 0 ? 'Remaining' : 'Bill Value'}</div>
                </div>
              </div>
              <div style="background:#fff;border-radius:6px;padding:7px 10px;border:1px solid #E2E8F0;font-size:11px">
                ${inv.paidAmount > 0 ? `<div style="display:flex;justify-content:space-between;color:#1E8E3E;margin-bottom:3px;padding-bottom:3px;border-bottom:1px solid #E6F4EA">
                  <span style="font-weight:600"><i class="fas fa-check-circle" style="margin-right:3px"></i>Already Paid</span>
                  <span style="font-weight:700">${INR(inv.paidAmount)}</span>
                </div>` : ''}
                <div style="display:flex;justify-content:space-between;color:var(--muted);margin-bottom:3px">
                  <span>Bill Value</span><span style="font-weight:600">${INR(netVal)}</span>
                </div>
                ${inv.paidAmount > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:3px">
                  <span style="color:#1E8E3E">Already Paid</span><span style="color:#1E8E3E;font-weight:600">- ${INR(inv.paidAmount)}</span>
                </div>` : ''}
                ${_discForInvoice(inv.invoiceNo) > 0 ? `<div style="display:flex;justify-content:space-between;margin-bottom:3px">
                  <span style="color:#7C3AED">Disc Given</span><span style="color:#7C3AED;font-weight:600">- ${INR(_discForInvoice(inv.invoiceNo))}</span>
                </div>` : ''}
                <div style="display:flex;justify-content:space-between;color:var(--muted);margin-bottom:3px">
                  ${tds > 0
                ? `<span>- TDS</span><span style="color:var(--red)">- ${INR(tds)}</span>`
                : `<span style="color:var(--sub)">TDS</span><span style="color:var(--sub)">NIL</span>`}
                </div>
                ${disc > 0 ? `<div style="display:flex;justify-content:space-between;color:var(--muted);margin-bottom:3px">
                  <span>- Cash Discount (${discLabel})</span><span style="color:var(--red)">- ${INR(disc)}</span>
                </div>` : ''}
                <div style="display:flex;justify-content:space-between;font-weight:800;border-top:1px solid #E2E8F0;padding-top:5px;margin-top:3px">
                  <span style="color:${pend > 0 ? 'var(--red)' : '#34A853'}">${pend > 0 ? 'Remaining to Pay' : 'Fully Settled'}</span>
                  <span style="color:${pend > 0 ? 'var(--red)' : '#34A853'};font-size:13px">${INR(pend)}</span>
                </div>
                <div style="margin-top:6px;padding-top:5px;border-top:1px dashed #E2E8F0">
                  <div style="font-size:9px;font-weight:700;color:#94A3B8;letter-spacing:.5px;margin-bottom:4px">PAYMENT REFERENCE</div>
                  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px">
                    <div style="background:#E6F4EA;border-radius:5px;padding:5px 6px;text-align:center">
                      <div style="font-size:9px;color:#1E8E3E;font-weight:700">1.5% disc</div>
                      <div style="font-size:12px;font-weight:800;color:#1E8E3E">${INR(exp15)}</div>
                    </div>
                    <div style="background:#FEF7E0;border-radius:5px;padding:5px 6px;text-align:center">
                      <div style="font-size:9px;color:#F9AB00;font-weight:700">1% disc</div>
                      <div style="font-size:12px;font-weight:800;color:#F9AB00">${INR(exp1)}</div>
                    </div>
                    <div style="background:#F9FAFB;border-radius:5px;padding:5px 6px;text-align:center;border:1px solid #E2E8F0">
                      <div style="font-size:9px;color:#6B7280;font-weight:700">Nil</div>
                      <div style="font-size:12px;font-weight:800;color:#475569">${INR(expNil)}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>`;
        }).join('');
        
        updateRPSummary();
      }

      function updateRPSummary() {
        const checks = document.querySelectorAll('.rp-inv-check:checked');
        let total = 0;
        checks.forEach(c => total += parseFloat(c.dataset.expected || 0));
        
        const summary = document.getElementById('rp-selection-summary');
        const selAmt = document.getElementById('rp-sel-amt');
        const selCount = document.getElementById('rp-sel-count');
        const amtInp = document.getElementById('rp-amount');
        
        if (checks.length > 0) {
          summary.style.display = 'block';
          selAmt.textContent = INR(total);
          selCount.textContent = checks.length + ' invoice(s)';
          // Show DTBG if non-zero
          const dtbgEl = document.getElementById('rp-dtbg');
          const dtbgAmt = dtbgEl ? (parseFloat(dtbgEl.value) || 0) : 0;
          let dtbgRow = document.getElementById('rp-dtbg-row');
          if (!dtbgRow) {
            dtbgRow = document.createElement('div');
            dtbgRow.id = 'rp-dtbg-row';
            dtbgRow.style.cssText = 'display:none;justify-content:space-between;font-size:12px;margin-top:4px';
            summary.appendChild(dtbgRow);
          }
          if (dtbgAmt > 0) {
            dtbgRow.innerHTML = '<span style="color:#7C3AED"><i class="fas fa-tag" style="margin-right:3px"></i>Discount TBG:</span><span style="font-weight:700;color:#7C3AED">' + INR(dtbgAmt) + '</span>';
            dtbgRow.style.display = 'flex';
          } else { dtbgRow.style.display = 'none'; }
          // Show reference breakdown below Amount field - user enters actual received
          const refRow = document.getElementById('rp-amount-ref');
          // Show bill value and expected breakdowns as reference
          // total = sum of pending amounts (data-expected = pend)
          // Get bill totals from data-billtotal
          let billTotal = 0;
          checks.forEach(c => billTotal += parseFloat(c.dataset.billtotal || c.dataset.expected || 0));
          let refHtml = '<span style="color:var(--red);font-weight:600">Pending: ' + INR(total) + '</span>';
          if (billTotal > total) {
            refHtml += ' &nbsp;<span style="color:var(--muted)">(Bill Value: ' + INR(billTotal) + ')</span>';
          }
          // Get disc/tds values
          const discEl = document.getElementById('rp-disc');
          const tdsEl  = document.getElementById('rp-tds');
          const discAmt = discEl ? (parseFloat(discEl.value) || 0) : 0;
          const tdsAmt  = tdsEl  ? (parseFloat(tdsEl.value)  || 0) : 0;
          if (discAmt > 0 || tdsAmt > 0) {
            const net = total - discAmt - tdsAmt;
            refHtml += ' &nbsp;→&nbsp; <span style="color:#1E8E3E;font-weight:600">After disc/TDS: ' + INR(net) + '</span>';
          }
          if (refRow) refRow.innerHTML = refHtml;
        } else {
          summary.style.display = 'none';
          const refRow = document.getElementById('rp-amount-ref');
          if (refRow) refRow.innerHTML = '';
        }
      }

      function openRPModal() {
        // Full reset first — no old values
        resetPaymentForm();
        _setDefaultDates();

        // Rebuild party SS fresh
        const opts = (DB.parties || []).map(p => ({
          id: p.partyID, name: p.name,
          meta: [p.city, p.partyCode].filter(Boolean).join(' - ')
        }));
        const ssEl = document.getElementById('rp-modal-ss');
        if (ssEl) {
          ssEl.innerHTML = '';
          buildSS('rp-modal-ss', opts, id => {
            const p = (DB.parties || []).find(x => x.partyID === id);
            if (!p) return;
            document.getElementById('rp-party-id').value = p.partyID;
            document.getElementById('rp-party-code').value = p.partyCode || '';
            document.getElementById('rp-party-name').value = p.name;
            onRPParty(id);
          }, 'Search party...');
        }
        document.getElementById('rp-modal').classList.add('show');
      }

      function closeRPModal() {
        const modal = document.getElementById('rp-modal');
        if (modal) {
          modal.classList.remove('show');
          modal.style.display = 'none';          // force hide as fallback
          setTimeout(() => { modal.style.display = ''; }, 50); // restore CSS control
        }
        // Close any open SweetAlert dialogs
        if (typeof Swal !== 'undefined') Swal.close();
        resetPaymentForm();
      }


      function openRPModalForParty(partyID) {
        openRPModal();
        setTimeout(() => {
          const p = (DB.parties || []).find(x => x.partyID === partyID);
          if (!p) return;
          document.getElementById('rp-party-id').value = p.partyID;
          document.getElementById('rp-party-code').value = p.partyCode || '';
          document.getElementById('rp-party-name').value = p.name;
          const inp = document.getElementById('rp-modal-ss-inp');
          if (inp) inp.value = p.name;
          if (_ssState['rp-modal-ss']) { _ssState['rp-modal-ss'].value = p.partyID; _ssState['rp-modal-ss'].text = p.name; }
          onRPParty(partyID);
        }, 120);
      }

      function resetPaymentForm() {
        // Clear all text/number fields
        ['rp-ref', 'rp-remarks', 'rp-party-id', 'rp-party-code', 'rp-party-name',
          'rp-amount', 'rp-tds', 'rp-disc', 'rp-dtbg', 'rp-bank'].forEach(id => {
            const e = document.getElementById(id);
            if (e) e.value = '';
          });
        // Reset mode
        const modeEl = document.getElementById('rp-mode');
        if (modeEl) modeEl.value = 'RTGS';
        // Reset date to today
        const dateEl = document.getElementById('rp-date');
        if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
        // Reset modal searchable select
        const inp1 = document.getElementById('rp-modal-ss-inp');
        if (inp1) { inp1.value = ''; inp1.dataset.val = ''; }
        if (_ssState && _ssState['rp-modal-ss']) {
          _ssState['rp-modal-ss'].value = '';
          _ssState['rp-modal-ss'].text = '';
        }
        // Hide bills/expected boxes
        const box = document.getElementById('rp-bills-box');
        if (box) box.style.display = 'none';
        const list = document.getElementById('rp-bills-list');
        if (list) list.innerHTML = '';
        const summary = document.getElementById('rp-selection-summary');
        if (summary) summary.style.display = 'none';
        const amtInp = document.getElementById('rp-amount');
        if (amtInp) delete amtInp.dataset.autofilled;
      }



      function submitPayment() {
        const partyID     = document.getElementById('rp-party-id').value;
        const totalAmount = parseFloat(document.getElementById('rp-amount').value) || 0;
        const tdsAmt      = parseFloat(document.getElementById('rp-tds').value)    || 0;
        const discAmt     = parseFloat(document.getElementById('rp-disc').value)   || 0;
        const payDate     = document.getElementById('rp-date').value;
        if (!partyID) { Swal.fire('Required', 'Select a party', 'warning'); return; }
        // Allow 0 cash only when TDS or Discount covers the settlement
        if (totalAmount <= 0 && tdsAmt <= 0 && discAmt <= 0) {
          Swal.fire('Required', 'Enter cash amount, or TDS / Discount to settle the invoice', 'warning'); return;
        }

        const checks = document.querySelectorAll('.rp-inv-check:checked');
        if (checks.length === 0) {
          Swal.fire('Required', 'Please select at least one invoice from the list above', 'warning');
          return;
        }

        const fmtDate = d => { const dt = new Date(d); return String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0') + '/' + dt.getFullYear(); };

        // Allocate cash across invoices. When cash=0 (TDS-only), still include invoice
        // with amount=0 so backend closes it via TDS.
        let allocated = [];
        let remaining = totalAmount;

        checks.forEach((c, idx) => {
          const invNo    = c.value;
          const expected = parseFloat(c.dataset.expected);
          let amt = 0;
          if (totalAmount > 0) {
            if (idx === checks.length - 1) {
              amt = remaining;
            } else {
              amt = Math.min(remaining, expected);
              remaining -= amt;
            }
          }
          // Always push — even amt=0, backend uses TDS/disc to decide closure
          allocated.push({ invoiceNo: invNo, amount: amt });
        });

        const data = {
          partyID,
          partyCode: document.getElementById('rp-party-code').value,
          partyName: document.getElementById('rp-party-name').value,
          paymentDate: fmtDate(payDate),
          amount: totalAmount,
          mode: document.getElementById('rp-mode').value,
          refNo: document.getElementById('rp-ref').value,
          tdsDeducted: parseFloat(document.getElementById('rp-tds').value) || 0,
          discountGiven: parseFloat(document.getElementById('rp-disc').value) || 0,
          discountToBeGiven: parseFloat((document.getElementById('rp-dtbg')||{}).value) || 0,
          bankName: (document.getElementById('rp-bank')||{}).value || '',
          remarks: document.getElementById('rp-remarks').value,
          invoices: allocated
        };

        Swal.fire({ title: 'Recording...', didOpen: () => Swal.showLoading(), background: '#0F172A', color: '#fff' });
        google.script.run
          .withSuccessHandler(r => {
            if (r.success) {
              Swal.fire({ icon: 'success', title: 'Payment Recorded!', text: r.msg, timer: 2500, showConfirmButton: false });
              closeRPModal();
              _silentDataRefresh();
            } else Swal.fire('Error', r.error, 'error');
          })
          .withFailureHandler(e => Swal.fire('Error', e.message, 'error'))
          .recordPayment(data, URL_NAME);
      }

      function openFUModal() {
        document.getElementById('fu-modal').classList.add('show');
        _setDefaultDates();
      }
      function closeFUModal() {
        document.getElementById('fu-modal').classList.remove('show');
        // Reset all FU form fields
        ['fu-notes','fu-contact','fu-promise-amt','fu-attach','fu-party-id','fu-party-code','fu-party-name',
         'fu-promise-date','fu-next-date','fu-next'].forEach(id => { const e = document.getElementById(id); if(e) e.value=''; });
        const mi = document.getElementById('fu-mode-inp'); if(mi) mi.value='Phone Call';
        const pr = document.getElementById('fu-priority'); if(pr) pr.value='Medium';
        const es = document.getElementById('fu-escalated'); if(es) es.value='No';
        const eb = document.getElementById('fu-escalated-to-box'); if(eb) eb.style.display='none';
        const et = document.getElementById('fu-escalated-to'); if(et) et.value='';
        const inp = document.getElementById('fu-ss-inp'); if(inp) inp.value='';
        if(_ssState && _ssState['fu-ss']){ _ssState['fu-ss'].value=''; _ssState['fu-ss'].text=''; }
        _setDefaultDates();
      }

      function toggleEscalation() {
        const v = document.getElementById('fu-escalated').value;
        document.getElementById('fu-escalated-to-box').style.display = v === 'Yes' ? 'block' : 'none';
      }

      function openFUModalForParty(partyID, invoiceID) {
        openFUModal();
        const p = (DB.parties || []).find(x => x.partyID === partyID);
        if (!p) return;
        const s = id => document.getElementById(id);
        if (s('fu-party-id')) s('fu-party-id').value = p.partyID;
        if (s('fu-party-code')) s('fu-party-code').value = p.partyCode || '';
        if (s('fu-party-name')) s('fu-party-name').value = p.name;
        const inp = document.getElementById('fu-ss-inp');
        if (inp) inp.value = p.name;
        if (_ssState['fu-ss']) { _ssState['fu-ss'].value = p.partyID; _ssState['fu-ss'].text = p.name; }
        onFUParty(partyID);
        if (invoiceID) {
          setTimeout(() => {
            const sel = document.getElementById('fu-invoice');
            if (sel) sel.value = invoiceID;
          }, 100);
        }
      }

      function onFUParty(partyID) {
        const pending_inv = (DB.invoices || []).filter(i => i.partyID === partyID && !isPaid(i));
        const sel = document.getElementById('fu-invoice');
        sel.innerHTML = '<option value="">-- All pending invoices --</option>';
        pending_inv.forEach(i => sel.add(new Option(`${i.invoiceNo}  ${INR(pending(i))}`, i.invoiceID)));
        const out = pending_inv.reduce((s, i) => s + pending(i), 0);
        document.getElementById('fu-party-id').value = partyID;
        const pi = (DB.parties || []).find(x => x.partyID === partyID);
        if (pi) {
          document.getElementById('fu-party-code').value = pi.partyCode || '';
          document.getElementById('fu-party-name').value = pi.name;
        }
        const hasOD = pending_inv.some(i => daysOD(i) > 0);
        document.getElementById('fu-priority').value = hasOD ? 'High' : 'Medium';
        window._fuOutstandingAmt = out;
      }

      function submitFollowUp() {
        const partyID = document.getElementById('fu-party-id').value;
        const notes = (document.getElementById('fu-notes').value || '').trim();
        if (!partyID) { Swal.fire('Required', 'Select a party', 'warning'); return; }
        if (!notes) { Swal.fire('Required', 'Notes are required', 'warning'); return; }

        const invEl = document.getElementById('fu-invoice');
        const selInvID = invEl.value;
        const selInv = (DB.invoices || []).find(i => i.invoiceID === selInvID);
        const outAmt = window._fuOutstandingAmt ||
          (DB.invoices || []).filter(i => i.partyID === partyID && !isPaid(i)).reduce((s, i) => s + pending(i), 0);

        const dtRaw = document.getElementById('fu-dt').value;
        const fmtDT = dtRaw ? dtRaw.replace('T', ' ') : '';
        const fmtDate = d => d ? (() => { const dt = new Date(d); return String(dt.getDate()).padStart(2, '0') + '/' + String(dt.getMonth() + 1).padStart(2, '0') + '/' + dt.getFullYear(); })() : '';

        const data = {
          partyID,
          partyCode: document.getElementById('fu-party-code').value,
          partyName: document.getElementById('fu-party-name').value,
          datetime: fmtDT,
          mode: document.getElementById('fu-mode-inp').value,
          contactPerson: document.getElementById('fu-contact').value,
          outstandingAmt: outAmt,
          invoiceID: selInvID,
          invoiceNo: selInv ? selInv.invoiceNo : '',
          notes,
          promiseAmt: parseFloat(document.getElementById('fu-promise-amt').value) || 0,
          promiseDate: fmtDate(document.getElementById('fu-promise-date').value),
          promiseKept: 'Pending',
          nextAction: document.getElementById('fu-next').value,
          nextActionDate: fmtDate(document.getElementById('fu-next-date').value),
          priority: document.getElementById('fu-priority').value,
          escalated: document.getElementById('fu-escalated').value,
          escalatedTo: document.getElementById('fu-escalated-to').value,
          attachmentURL: document.getElementById('fu-attach').value
        };

        Swal.fire({ title: 'Saving...', didOpen: () => Swal.showLoading(), background: '#0F172A', color: '#fff' });
        google.script.run
          .withSuccessHandler(r => {
            if (r.success) {
              Swal.fire({ icon: 'success', title: 'Follow-up Logged!', text: r.msg, timer: 1800, showConfirmButton: false });
              closeFUModal();
              _silentDataRefresh();
            } else Swal.fire('Error', r.error, 'error');
          })
          .withFailureHandler(e => Swal.fire('Error', e.message, 'error'))
          .saveFollowUp(data, URL_NAME);
      }

      function updatePromise(followUpID, kept) {
        google.script.run
          .withSuccessHandler(r => {
            if (r.success) {
              _silentDataRefresh();
              Swal.fire({ icon: 'success', title: 'Updated!', timer: 1200, showConfirmButton: false });
            }
          })
          .updatePromiseKept(followUpID, kept, URL_NAME);
      }

      function sdInit(wrapId, options, onSelect, placeholder) {
        const wrap = document.getElementById(wrapId);
        if (!wrap) return;
        wrap.className = 'sd-wrap';
        const ph = placeholder || 'Select party...';
        wrap.innerHTML = `
    <div class="sd-input" id="${wrapId}-inp" tabindex="0" onclick="sdOpen('${wrapId}')">${ph}</div>
    <div class="sd-drop" id="${wrapId}-drop">
      <div class="sd-search-box">
        <input class="sd-search" id="${wrapId}-srch" placeholder="Search..."
          oninput="sdFilter('${wrapId}')" onclick="event.stopPropagation()" autocomplete="off">
      </div>
      <div class="sd-list" id="${wrapId}-list"></div>
    </div>`;
        wrap._options = options;
        wrap._onSelect = onSelect;
        wrap._value = '';
        sdRenderList(wrapId, options);
        document.addEventListener('click', e => {
          if (!e.target.closest('#' + wrapId)) sdClose(wrapId);
        });
      }

      function sdRenderList(wrapId, opts) {
        const list = document.getElementById(wrapId + '-list');
        if (!list) return;
        if (!opts.length) { list.innerHTML = '<div class="sd-empty">No results</div>'; return; }
        list.innerHTML = opts.map(o =>
          `<div class="sd-option" onclick="sdSelect('${wrapId}','${escQ(o.value)}','${escQ(o.label)}')" data-val="${escQ(o.value)}">
      ${o.label}${o.sub ? `<div class="sd-sub">${o.sub}</div>` : ''}
    </div>`
        ).join('');
      }

      function sdFilter(wrapId) {
        const wrap = document.getElementById(wrapId);
        const q = (document.getElementById(wrapId + '-srch').value || '').toLowerCase();
        const filtered = (wrap._options || []).filter(o =>
          o.label.toLowerCase().includes(q) || (o.sub || '').toLowerCase().includes(q)
        );
        sdRenderList(wrapId, filtered);
      }

      function sdOpen(wrapId) {
        document.querySelectorAll('.sd-drop.open').forEach(d => {
          if (d.id !== wrapId + '-drop') d.classList.remove('open');
        });
        const drop = document.getElementById(wrapId + '-drop');
        if (drop) drop.classList.toggle('open');
        const srch = document.getElementById(wrapId + '-srch');
        if (srch) setTimeout(() => srch.focus(), 50);
      }

      function sdClose(wrapId) {
        const drop = document.getElementById(wrapId + '-drop');
        if (drop) drop.classList.remove('open');
      }

      function sdSelect(wrapId, value, label) {
        const wrap = document.getElementById(wrapId);
        const inp = document.getElementById(wrapId + '-inp');
        if (inp) inp.textContent = label;
        if (inp) inp.style.color = 'var(--text)';
        if (wrap) wrap._value = value;
        sdClose(wrapId);
        if (wrap && wrap._onSelect) wrap._onSelect(value, label);
      }

      function sdSetOptions(wrapId, options) {
        const wrap = document.getElementById(wrapId);
        if (!wrap) return;
        wrap._options = options;
        sdRenderList(wrapId, options);
        sdFilter(wrapId);
      }

      function sdGetValue(wrapId) {
        const wrap = document.getElementById(wrapId);
        return wrap ? (wrap._value || '') : '';
      }

      function sdReset(wrapId, placeholder) {
        const wrap = document.getElementById(wrapId);
        const inp = document.getElementById(wrapId + '-inp');
        if (inp) { inp.textContent = placeholder || 'Select party...'; inp.style.color = 'var(--sub)'; }
        if (wrap) wrap._value = '';
        const srch = document.getElementById(wrapId + '-srch');
        if (srch) srch.value = '';
        if (wrap && wrap._options) sdRenderList(wrapId, wrap._options);
      }

      function _partyOptions(includeAll) {
        const opts = includeAll ? [{ value: '', label: 'All Parties', sub: '' }] : [];
        return opts.concat((DB.parties || []).map(p => ({
          value: p.partyID,
          label: p.name,
          sub: [p.partyCode, p.city, p.head].filter(Boolean).join('  ')
        })));
      }

      let _csvParsed = [];

      function handleDrop(e) {
        e.preventDefault();
        document.getElementById('drop-zone').style.borderColor = '';
        if (e.dataTransfer.files[0]) routeFile(e.dataTransfer.files[0]);
      }
      function handleFile(inp) { if (inp.files[0]) routeFile(inp.files[0]); }

      function routeFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'pdf') { processPDFFile(file); return; }
        processFile(file);
      }

      // ============================================================
      // PDF INVOICE IMPORT — parses the Fresko multi-invoice Tally PDF
      // (one invoice per page, or per group of pages for long item lists)
      // entirely client-side via pdf.js. Produces the same _csvParsed
      // shape the CSV/Excel path produces, so uploadCSV() works unchanged.
      // ============================================================
      async function processPDFFile(file) {
        document.getElementById('csv-status').style.display = 'none';
        if (typeof pdfjsLib === 'undefined') { showCSVStatus('error', 'PDF parser is still loading. Please wait a moment and try again.'); return; }
        const dz = document.getElementById('drop-zone');
        if (dz) { dz.style.opacity = '.5'; dz.style.pointerEvents = 'none'; }
        const prog = document.getElementById('pdf-progress');
        const progBar = document.getElementById('pdf-progress-bar');
        const progTxt = document.getElementById('pdf-progress-txt');
        if (prog) prog.style.display = 'block';
        try {
          const buf = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
          const totalPages = pdf.numPages;
          const extracted = [], badPages = [];
          const MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
          for (let p = 1; p <= totalPages; p++) {
            if (progBar) progBar.style.width = Math.round((p/totalPages)*100)+'%';
            if (progTxt) progTxt.textContent = `Reading page ${p} of ${totalPages}...`;
            const page = await pdf.getPage(p);
            const tc = await page.getTextContent();
            const strs = tc.items.map(it => it.str).filter(s => s.trim() !== '');
            if (!strs.some(s => s.includes('INVOICE TOTAL'))) continue;
            let invNo=null, invDate=null, partyName=null, billValue=null, marketChg=null, netAmt=null;
            for (const s of strs) { const m=s.match(/^(\d{4}-\d{2}\/\d+)$/); if(m){invNo=m[1];break;} }
            for (const s of strs) { const m=s.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})/); if(m){const mm=MONTHS[m[2].slice(0,3).toLowerCase()];if(mm)invDate=m[1].padStart(2,'0')+'/'+String(mm).padStart(2,'0')+'/'+m[3];break;} }
            for (let i=0;i<strs.length;i++) {
              if (strs[i]==='Party Name'||strs[i].startsWith('Party Name')) {
                for (let b=i-1;b>=Math.max(0,i-5);b--) { const cand=strs[b].trim(); if(cand.length>2&&!/^(INVOICE|AGRONICO|Page |MAIL|MSME|:)/.test(cand)&&!/^\d{1,2}-[A-Za-z]+-\d{4}/.test(cand)&&!/^[0-9]{2}[A-Z]/.test(cand)){partyName=cand.replace(/\s{2,}/g,' ');break;} }
                break;
              }
            }
            for (let i=0;i<strs.length;i++) {
              if (strs[i].includes('INVOICE TOTAL')) { const nums=[]; for(let j=i+1;j<Math.min(i+5,strs.length);j++){const m=strs[j].match(/^([\d,]+\.\d{2})$/);if(m)nums.push(parseFloat(m[1].replace(/,/g,'')));if(nums.length===2)break;} if(nums.length>=1)billValue=nums[0];if(nums.length>=2)marketChg=nums[1]; }
              if (strs[i].includes('Net Amt')) { const m=strs[i].match(/Net\s*Amt\s*:?\s*([\d,]+\.\d{2})/i);if(m){netAmt=parseFloat(m[1].replace(/,/g,''));}else if(i+1<strs.length){const m2=strs[i+1].match(/^([\d,]+\.\d{2})$/);if(m2)netAmt=parseFloat(m2[1].replace(/,/g,''));} }
            }
            if(!netAmt&&billValue)netAmt=billValue;
            if(!invNo||!invDate||!partyName||!netAmt){badPages.push(p);continue;}
            extracted.push({invoiceNo:invNo,invoiceDate:invDate,partyName:partyName.slice(0,120),billValue:billValue||netAmt,marketChg:marketChg||0,netAmt:netAmt,page:p});
          }
          if(dz){dz.style.opacity='';dz.style.pointerEvents='';}
          if(prog)prog.style.display='none';
          if(!extracted.length){showCSVStatus('error',badPages.length?'No invoices could be read ('+badPages.length+' page(s) had an unrecognized layout).':'No invoices found in this PDF.');return;}
          _buildPreviewFromPDFInvoices(extracted,file,totalPages,badPages);
        } catch(err) {
          if(dz){dz.style.opacity='';dz.style.pointerEvents='';}
          if(prog)prog.style.display='none';
          showCSVStatus('error','Error reading PDF: '+err.message);
        }
      }
      function _buildPreviewFromPDFInvoices(rows, file, totalPages, badPages) {
        _csvParsed = [];
        const preview = [];
        let validCnt = 0, skipCnt = 0;

        const existingNos = new Set((DB.invoices || []).map(i => (i.invoiceNo || '').toLowerCase()));
        const partyByName = {};
        (DB.parties || []).forEach(p => { if (p.name) partyByName[p.name.toLowerCase()] = p; });

        rows.forEach(r => {
          const nameRaw = r.partyName || '';
          let party = partyByName[nameRaw.toLowerCase()] || null;
          if (!party && nameRaw.length >= 4) {
            const slug = nameRaw.toLowerCase().slice(0, 8);
            const key = Object.keys(partyByName).find(k => k.startsWith(slug));
            if (key) party = partyByName[key];
          }

          const parts = r.invoiceDate.split('/'); // DD/MM/YYYY
          let bd = null;
          if (parts.length === 3) bd = new Date(+parts[2], +parts[1] - 1, +parts[0]);
          if (!bd || isNaN(bd)) return;

          const pad = n => String(n).padStart(2, '0');
          const billDateStr = pad(bd.getDate()) + '/' + pad(bd.getMonth() + 1) + '/' + bd.getFullYear();

          let dueDays = 30, slabPct = '0';
          if (party) {
            if (party.days15) { dueDays = party.days15; slabPct = '1.5'; }
            else if (party.days1) { dueDays = party.days1; slabPct = '1'; }
            else if (party.days0) { dueDays = party.days0; slabPct = '0'; }
          }
          const dueD = new Date(bd); dueD.setDate(dueD.getDate() + dueDays);
          const dueDateStr = pad(dueD.getDate()) + '/' + pad(dueD.getMonth() + 1) + '/' + dueD.getFullYear();

          const isDup = r.invoiceNo && existingNos.has(r.invoiceNo.toLowerCase());
          let status = 'ok';
          if (!party) status = 'warn';
          if (isDup || !r.invoiceNo || !r.netAmt) status = 'skip';
          status === 'skip' ? skipCnt++ : validCnt++;

          const displayName = party ? party.name : (nameRaw || '?');
          preview.push({ billNo: r.invoiceNo, dateRaw: billDateStr, billDateStr, dueDateStr, amount: r.netAmt, party, displayName, slabPct, dueDays, status });

          if (status !== 'skip') {
            _csvParsed.push({
              partyID: party ? party.partyID : '',
              partyCode: party ? party.partyCode : '',
              partyName: party ? party.name : nameRaw,
              invoiceNo: r.invoiceNo,
              invoiceDate: billDateStr,
              dueDate: dueDateStr,
              dueDays,
              slabPct,
              billValue: r.billValue || r.netAmt,
              cgst: 0,
              sgst: 0,
              igst: 0,
              tcs: 0,
              otherDed: r.marketChg || 0,
              netAmount: r.netAmt,
              vehicleNo: '',
              head: party ? (party.head || '') : '',
              remarks: 'Imported from PDF (page ' + r.page + ')'
            });
          }
        });

        document.getElementById('csv-fname').textContent = file.name;
        document.getElementById('csv-fmeta').textContent =
          `${(file.size / 1024 / 1024).toFixed(2)} MB  ${totalPages} pages  ${rows.length} invoices found` +
          (badPages.length ? `  ${badPages.length} page(s) unreadable` : '');
        document.getElementById('csv-file-info').style.display = 'flex';
        txt('csv-valid-cnt', '[OK] ' + validCnt + ' ready');
        txt('csv-skip-cnt', skipCnt > 0 ? '[X] ' + skipCnt + ' skip' : '');
        txt('csv-total-cnt', rows.length + ' total invoices');

        document.getElementById('csv-preview-tbl').innerHTML =
          `<thead><tr>
          <th>#</th><th>Invoice No</th><th>Date</th><th>Party</th>
          <th class="num">Net Amt</th><th>Slab</th><th>Due Date</th><th>Status</th>
        </tr></thead>
        <tbody>
        ${preview.slice(0, 10).map((r, i) => `
          <tr style="background:${r.status === 'skip' ? '#FCE8E6' : r.status === 'warn' ? '#FEF7E0' : ''}">
            <td style="color:var(--sub)">${i + 1}</td>
            <td style="font-family:monospace;font-weight:600">${r.billNo || '--'}</td>
            <td style="font-size:11px">${r.billDateStr}</td>
            <td style="max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px"
                title="${r.displayName}">${r.displayName}</td>
            <td class="num">${INR(r.amount)}</td>
            <td>${slabBadge(r.slabPct)}</td>
            <td style="font-size:10px">${r.dueDateStr}</td>
            <td>${r.status === 'ok'
                  ? '<span class="badge badge-paid">[OK] OK</span>'
                  : r.status === 'warn'
                    ? '<span class="badge badge-partpaid">[!] No Party</span>'
                    : '<span class="badge badge-overdue">[X] Skip</span>'}</td>
          </tr>`).join('')}
        ${preview.length > 10
            ? `<tr><td colspan="8" class="center" style="color:var(--sub);font-size:11px;padding:8px">
              + ${preview.length - 10} more rows...
             </td></tr>` : ''}
        </tbody>`;
        document.getElementById('csv-preview-box').style.display = 'block';

        const btn = document.getElementById('csv-upload-btn');
        btn.disabled = validCnt === 0;
        btn.style.opacity = validCnt > 0 ? '1' : '0.5';
        btn.innerHTML = `<i class="fas fa-cloud-upload-alt"></i> Upload ${validCnt} invoices to SalesInvoices`;

        if (badPages.length) {
          showCSVStatus('warn', badPages.length + ' page(s) could not be read and were skipped (unrecognized layout): page ' + badPages.slice(0, 15).join(', ') + (badPages.length > 15 ? '...' : ''));
        }
      }

      function processFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['csv', 'xlsx', 'xls'].includes(ext)) {
          showCSVStatus('error', 'Please select a .csv, .xlsx or .pdf file only.'); return;
        }
        document.getElementById('csv-status').style.display = 'none';

        const dz = document.getElementById('drop-zone');
        if (dz) { dz.style.opacity = '.5'; dz.style.pointerEvents = 'none'; }

        const reader = new FileReader();

        reader.onload = function (ev) {
          try {
            let allRows = []; // 2D array -- allRows[rowIdx][colIdx]

            if (ext === 'csv') {
              const raw = ev.target.result.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
              const parseCSVLine = line => {
                const res = []; let cur = ''; let inQ = false;
                for (let i = 0; i < line.length; i++) {
                  const ch = line[i];
                  if (ch === '"') { inQ = !inQ; continue; }
                  if (ch === ',' && !inQ) { res.push(cur.trim()); cur = ''; continue; }
                  cur += ch;
                }
                res.push(cur.trim()); return res;
              };
              allRows = raw.split('\n').map(l => parseCSVLine(l));

            } else {
              if (typeof XLSX === 'undefined') {
                showCSVStatus('error', 'Excel parser not loaded. Please wait a moment and try again.'); return;
              }
              const data = new Uint8Array(ev.target.result);
              const wb = XLSX.read(data, { type: 'array', cellDates: false, raw: true });
              const ws = wb.Sheets[wb.SheetNames[0]]; // First sheet
              allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
            }

            if (dz) { dz.style.opacity = ''; dz.style.pointerEvents = ''; }
            if (!allRows.length) { showCSVStatus('error', 'File is empty.'); return; }

            let headerRowIdx = -1;
            let headers = [];
            for (let i = 0; i < Math.min(15, allRows.length); i++) {
              const cells = allRows[i].map(h =>
                h.toString().toLowerCase()
                  .replace(/[^a-z0-9.]/g, '_')
                  .replace(/_+$/, '')
                  .replace(/^_+/, '')
              );
              if (cells.some(c => c === 'date' || c === 'dt') &&
                cells.some(c => c.includes('bill') || c.includes('name'))) {
                headerRowIdx = i;
                headers = cells;
                break;
              }
            }

            if (headerRowIdx === -1) {
              showCSVStatus('error',
                'Could not find header row (DATE, BILL NO. columns). ' +
                'Make sure file is exported from accounting software in original format.'
              ); return;
            }

            const dataRows = allRows.slice(headerRowIdx + 1);

            const fc = (...names) => {
              for (const n of names) {
                const slug = n.toLowerCase().replace(/[^a-z0-9]/g, '');
                const i = headers.findIndex(h => h.replace(/[^a-z0-9]/g, '').includes(slug));
                if (i !== -1) return i;
              }
              return -1;
            };

            const colDate = fc('date', 'dt', 'billdate', 'invoicedate');
            const colBillNo = fc('billno', 'bill_no', 'bill no', 'invoiceno', 'inv_no');
            const colAmt = fc('net_value', 'netvalue', 'net value', 'net');

            const colName = fc('name', 'partyname', 'party_name', 'party');
            const colCode = fc('party_code', 'partycode', 'code');
            const colCity = fc('city');
            const colDesc = fc('description', 'desc', 'particulars', 'item');
            const colGross = fc('bill_value', 'billvalue', 'bill value', 'gross');
            const colCGST = fc('cgst', 'c_gst', 'c.gst');
            const colSGST = fc('sgst', 's_gst', 's.gst');
            const colIGST = fc('igst', 'i_gst', 'i.gst');
            const colCess = fc('cess');
            const colTCS = fc('tcs');
            const colVeh = fc('vehicle_no', 'vehicleno', 'vehicle no', 'vehicle');

            const colExpAll = [];
            headers.forEach((h, i) => {
              const slug = h.replace(/[^a-z0-9]/g, '');
              if (/^exp\d*$/.test(slug) || slug === '194q' || slug.includes('tcs1h')) {
                colExpAll.push(i);
              }
            });

            const allCols = {
              'Date': colDate,
              'Party Name': colName,
              'Bill No': colBillNo,
              'Net Value': colAmt
            };
            document.getElementById('csv-map-grid').innerHTML = Object.entries(allCols).map(([k, v]) =>
              `<div style="background:${v === -1 ? '#FCE8E6' : '#E6F4EA'};border:1px solid ${v === -1 ? '#F6AEA9' : '#A8DAB5'};border-radius:7px;padding:8px 10px">
          <div style="font-size:10px;font-weight:700;color:var(--muted)">${k}</div>
          <div style="font-size:11px;font-weight:600;color:${v === -1 ? 'var(--red)' : 'var(--green)'}">
            ${v === -1 ? 'NOT FOUND' : 'Col ' + (v + 1) + ': ' + headers[v]}
          </div>
        </div>`
            ).join('');
            document.getElementById('csv-map-box').style.display = 'block';

            if (colDate === -1 || colBillNo === -1 || colAmt === -1) {
              showCSVStatus('error', 'Required columns not found. Need: DATE  BILL NO.  NET VALUE');
              return;
            }

            const existingNos = new Set((DB.invoices || []).map(i => (i.invoiceNo || '').toLowerCase()));
            const partyByCode = {};
            const partyByName = {};
            (DB.parties || []).forEach(p => {
              if (p.partyCode) partyByCode[p.partyCode.toLowerCase()] = p;
              if (p.name) partyByName[p.name.toLowerCase()] = p;
            });

            _csvParsed = [];
            const preview = [];
            let validCnt = 0, skipCnt = 0;

            const safeStr = v => (v === null || v === undefined) ? '' : v.toString().trim();
            const safeN = (row, i) => i !== -1 ? (parseFloat(safeStr(row[i]).replace(/[,₹\s]/g, '')) || 0) : 0;

            dataRows.forEach(row => {
              if (!row || row.length === 0) return;
              if (row.every(c => safeStr(c) === '')) return;

              const billNo = safeStr(row[colBillNo]);
              const dateRaw = safeStr(row[colDate]);
              const amount = safeN(row, colAmt);

              const rowJoined = row.map(safeStr).join(' ').toUpperCase();
              if (rowJoined.includes('TOTAL') && !billNo) return;
              if (!billNo && !amount) return;

              const nameRaw = safeStr(colName !== -1 ? row[colName] : '');
              const codeRaw = safeStr(colCode !== -1 ? row[colCode] : '');

              let party = null;
              if (codeRaw) party = partyByCode[codeRaw.toLowerCase()] || null;
              if (!party && nameRaw) {
                party = partyByName[nameRaw.toLowerCase()] || null;
                if (!party && nameRaw.length >= 4) {
                  const slug = nameRaw.toLowerCase().slice(0, 8);
                  const key = Object.keys(partyByName).find(k => k.startsWith(slug));
                  if (key) party = partyByName[key];
                }
              }

              let billDateStr = '', dueDateStr = '';
              let bd = null;
              const dv = safeStr(row[colDate]);

              if (!isNaN(dv) && dv !== '' && +dv > 1000) {
                const d = XLSX.SSF.parse_date_code(+dv);
                if (d) bd = new Date(d.y, d.m - 1, d.d);
              } else {
                const parts = dv.split(/[-\/]/);
                if (parts.length === 3) {
                  if (parts[0].length === 4) bd = new Date(+parts[0], +parts[1] - 1, +parts[2]);
                  else bd = new Date(+parts[2], +parts[1] - 1, +parts[0]);
                }
              }
              if (!bd || isNaN(bd)) return;

              const pad = n => String(n).padStart(2, '0');
              billDateStr = pad(bd.getDate()) + '/' + pad(bd.getMonth() + 1) + '/' + bd.getFullYear();

              let dueDays = 30, slabPct = '0';
              if (party) {
                if (party.days15) { dueDays = party.days15; slabPct = '1.5'; }
                else if (party.days1) { dueDays = party.days1; slabPct = '1'; }
                else if (party.days0) { dueDays = party.days0; slabPct = '0'; }
              }
              const dueD = new Date(bd); dueD.setDate(dueD.getDate() + dueDays);
              dueDateStr = pad(dueD.getDate()) + '/' + pad(dueD.getMonth() + 1) + '/' + dueD.getFullYear();

              const isDup = billNo && existingNos.has(billNo.toLowerCase());
              let status = 'ok';
              if (!party) status = 'warn';
              if (isDup || !billNo || !amount) status = 'skip';
              status === 'skip' ? skipCnt++ : validCnt++;

              const displayName = party ? party.name : (nameRaw || codeRaw || '?');
              preview.push({ billNo, dateRaw: billDateStr, billDateStr, dueDateStr, amount, party, displayName, slabPct, dueDays, status });

              if (status !== 'skip') {
                _csvParsed.push({
                  partyID: party ? party.partyID : '',
                  partyCode: party ? party.partyCode : codeRaw,
                  partyName: party ? party.name : (nameRaw || codeRaw || ''),
                  invoiceNo: billNo,
                  invoiceDate: billDateStr,
                  dueDate: dueDateStr,
                  dueDays,
                  slabPct,
                  billValue: safeN(row, colGross) || amount,
                  cgst: safeN(row, colCGST),
                  sgst: safeN(row, colSGST),
                  igst: safeN(row, colIGST),
                  tcs: safeN(row, colTCS),
                  otherDed: colExpAll.reduce((s, i) => s + safeN(row, i), 0) + safeN(row, colCess),
                  netAmount: amount,
                  vehicleNo: safeStr(colVeh !== -1 ? row[colVeh] : ''),
                  head: safeStr(colDesc !== -1 ? row[colDesc] : '') || (party ? (party.head || '') : ''),
                  remarks: ''
                });
              }
            });

            document.getElementById('csv-fname').textContent = file.name;
            document.getElementById('csv-fmeta').textContent =
              `${(file.size / 1024).toFixed(1)} KB  ${dataRows.length} rows  header at row ${headerRowIdx + 1}`;
            document.getElementById('csv-file-info').style.display = 'flex';
            txt('csv-valid-cnt', '[OK] ' + validCnt + ' ready');
            txt('csv-skip-cnt', skipCnt > 0 ? '[X] ' + skipCnt + ' skip' : '');
            txt('csv-total-cnt', dataRows.length + ' total rows');

            document.getElementById('csv-preview-tbl').innerHTML =
              `<thead><tr>
          <th>#</th><th>Bill No</th><th>Date</th><th>Party</th>
          <th class="num">Net Amt</th><th>Slab</th><th>Due Date</th><th>Status</th>
        </tr></thead>
        <tbody>
        ${preview.slice(0, 10).map((r, i) => `
          <tr style="background:${r.status === 'skip' ? '#FCE8E6' : r.status === 'warn' ? '#FEF7E0' : ''}">
            <td style="color:var(--sub)">${i + 1}</td>
            <td style="font-family:monospace;font-weight:600">${r.billNo || '--'}</td>
            <td style="font-size:11px">${r.billDateStr}</td>
            <td style="max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px"
                title="${r.displayName}">${r.displayName}</td>
            <td class="num">${INR(r.amount)}</td>
            <td>${slabBadge(r.slabPct)}</td>
            <td style="font-size:10px">${r.dueDateStr}</td>
            <td>${r.status === 'ok'
                  ? '<span class="badge badge-paid">[OK] OK</span>'
                  : r.status === 'warn'
                    ? '<span class="badge badge-partpaid">[!] No Party</span>'
                    : '<span class="badge badge-overdue">[X] Skip</span>'}</td>
          </tr>`).join('')}
        ${preview.length > 10
                ? `<tr><td colspan="8" class="center" style="color:var(--sub);font-size:11px;padding:8px">
              + ${preview.length - 10} more rows...
             </td></tr>` : ''}
        </tbody>`;
            document.getElementById('csv-preview-box').style.display = 'block';

            const btn = document.getElementById('csv-upload-btn');
            btn.disabled = validCnt === 0;
            btn.style.opacity = validCnt > 0 ? '1' : '0.5';
            btn.innerHTML = `<i class="fas fa-cloud-upload-alt"></i> Upload ${validCnt} invoices to SalesInvoices`;

          } catch (err) {
            if (dz) { dz.style.opacity = ''; dz.style.pointerEvents = ''; }
            showCSVStatus('error', 'Error reading file: ' + err.message);
          }
        };

        if (ext === 'csv') {
          reader.readAsText(file, 'UTF-8');
        } else {
          reader.readAsArrayBuffer(file);
        }
      }

      function clearCSV() {
        _csvParsed = [];
        document.getElementById('csv-inp').value = '';
        document.getElementById('csv-file-info').style.display = 'none';
        document.getElementById('csv-preview-box').style.display = 'none';
        document.getElementById('csv-map-box').style.display = 'none';
        document.getElementById('csv-status').style.display = 'none';
        const pdfProg = document.getElementById('pdf-progress');
        if (pdfProg) pdfProg.style.display = 'none';
        const btn = document.getElementById('csv-upload-btn');
        btn.disabled = true; btn.style.opacity = '0.5';
        btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Upload to SalesInvoices';
      }

      function showCSVStatus(type, msg) {
        const el = document.getElementById('csv-status');
        el.className = 'info-box ' + (type === 'success' ? 'green' : type === 'warn' ? 'amber' : 'red');
        el.innerHTML = `<i class="fas fa-${type === 'success' ? 'check-circle' : type === 'warn' ? 'exclamation-triangle' : 'exclamation-circle'}"></i><span>${msg}</span>`;
        el.style.display = 'flex';
      }

      function uploadCSV() {
        if (!_csvParsed.length) { showCSVStatus('warn', 'No valid rows to upload.'); return; }
        const btn = document.getElementById('csv-upload-btn');
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading ' + _csvParsed.length + ' rows...';
        google.script.run
          .withSuccessHandler(r => {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-cloud-upload-alt"></i> Upload to SalesInvoices';
            if (r.success) {
              showCSVStatus('success', '[OK] ' + r.rowsAdded + ' invoices added' + (r.skipped > 0 ? ', ' + r.skipped + ' duplicates skipped.' : '.'));
              clearCSV();
              _silentDataRefresh();
            } else showCSVStatus('error', 'Upload failed: ' + (r.error || 'Unknown error'));
          })
          .withFailureHandler(e => { btn.disabled = false; btn.innerHTML = 'Upload'; showCSVStatus('error', 'Connection error: ' + e.message); })
          .bulkUploadInvoices(_csvParsed, '', URL_NAME);
      }

      function resetRptFilters() {
        ['rpt-from', 'rpt-to'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
        try { sdReset('rpt-ss', 'All Parties'); } catch(e) { resetSS('rpt-ss'); }
        loadReports();
      }

      function loadReports() {
        if (!window._canViewAnalytics) { nav('dashboard'); return; }
        const filters = {
          partyID: sdGetValue('rpt-ss') || '',
          from: (document.getElementById('rpt-from') || {}).value || '',
          to: (document.getElementById('rpt-to') || {}).value || ''
        };
        google.script.run
          .withSuccessHandler(data => {
            if (!data.success) return;
            buildCharts(data);
          })
          .getAnalytics(filters);
      }

      const C = { red: '#EA4335', dark: '#1C1C1C', grey: '#8A8A8A', green: '#34A853', amber: '#F9AB00', blue: '#1967D2' };

      function mkChart(id, config) {
        if (_charts[id]) { _charts[id].destroy(); }
        const canvas = document.getElementById(id);
        if (!canvas) return;
        _charts[id] = new Chart(canvas, config);
      }

      function buildCharts(data) {
        const inrK = v => v >= 1000000 ? '₹' + (v / 100000).toFixed(1) + 'L' : v >= 1000 ? '₹' + (v / 1000).toFixed(0) + 'K' : '₹' + v;

        mkChart('ch-party', {
          type: 'bar', data: {
            labels: data.byParty.map(x => x.name.length > 16 ? x.name.slice(0, 15) + '...' : x.name),
            datasets: [{
              label: 'Outstanding', data: data.byParty.map(x => x.amt),
              backgroundColor: data.byParty.map((_, i) => i === 0 ? C.red : i % 3 === 1 ? C.dark : C.grey),
              borderRadius: 5, borderSkipped: false
            }]
          }, options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + INR(ctx.raw) } } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 30, color: '#64748B' } },
              y: { grid: { color: '#F1F5F9' }, ticks: { callback: v => inrK(v), font: { size: 9 }, color: '#64748B' } }
            }
          }
        });

        mkChart('ch-slab', {
          type: 'doughnut', data: {
            labels: ['1.5% Slab', '1% Slab', 'Nil Slab'],
            datasets: [{
              data: [data.slabMap['1.5'] || 0, data.slabMap['1'] || 0, data.slabMap['0'] || 0],
              backgroundColor: [C.green, C.amber, C.grey], borderWidth: 2, borderColor: '#fff', hoverOffset: 4
            }]
          }, options: {
            responsive: true, maintainAspectRatio: false, cutout: '65%',
            plugins: {
              legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 12, usePointStyle: true } },
              tooltip: { callbacks: { label: ctx => ' ' + INR(ctx.raw) } }
            }
          }
        });

        mkChart('ch-monthly', {
          type: 'line', data: {
            labels: data.monthlyColl.map(x => { const p = x.month.split('-'); return p[1] + '/' + p[0].slice(2); }),
            datasets: [{
              label: 'Collections', data: data.monthlyColl.map(x => x.amt),
              borderColor: C.red, backgroundColor: 'rgba(192,21,42,0.08)',
              pointBackgroundColor: C.red, pointRadius: 3, tension: 0.35, fill: true, borderWidth: 2
            }]
          }, options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + INR(ctx.raw) } } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 9 }, color: '#64748B' } },
              y: { grid: { color: '#F1F5F9' }, ticks: { callback: v => inrK(v), font: { size: 9 }, color: '#64748B' } }
            }
          }
        });

        const statuses = Object.keys(data.statusMap);
        const statColors = { Paid: C.green, Pending: C.blue, PartPaid: C.amber, Overdue: C.red, Disputed: '#7C3AED', Cancelled: C.grey };
        mkChart('ch-status', {
          type: 'bar', data: {
            labels: statuses,
            datasets: [{
              data: statuses.map(s => data.statusMap[s]),
              backgroundColor: statuses.map(s => statColors[s] || C.grey),
              borderRadius: 5, borderSkipped: false
            }]
          }, options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { grid: { color: '#F1F5F9' }, ticks: { font: { size: 9 }, color: '#64748B' } },
              y: { grid: { display: false }, ticks: { font: { size: 10, weight: '600' }, color: '#374151' } }
            }
          }
        });

        const bucketLabels = ['1-7d', '8-15d', '16-30d', '31-60d', '60d+'];
        const bucketVals = [data.ageBuckets['1-7'], data.ageBuckets['8-15'], data.ageBuckets['16-30'], data.ageBuckets['31-60'], data.ageBuckets['60+']];
        mkChart('ch-age', {
          type: 'bar', data: {
            labels: bucketLabels,
            datasets: [{
              data: bucketVals,
              backgroundColor: ['#FEEFC3', '#FED7AA', '#FCA5A5', '#EE675C', C.red],
              borderRadius: 5, borderSkipped: false
            }]
          }, options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ' ' + INR(ctx.raw) } } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 10 }, color: '#374151' } },
              y: { grid: { color: '#F1F5F9' }, ticks: { callback: v => inrK(v), font: { size: 9 }, color: '#64748B' } }
            }
          }
        });

        const fuModes = Object.keys(data.fuModeMap);
        mkChart('ch-fumode', {
          type: 'polarArea', data: {
            labels: fuModes,
            datasets: [{
              data: fuModes.map(m => data.fuModeMap[m]),
              backgroundColor: ['rgba(59,130,246,.75)', 'rgba(34,197,94,.75)', 'rgba(192,21,42,.75)', 'rgba(107,114,128,.75)', 'rgba(168,85,247,.75)'],
              borderWidth: 1, borderColor: '#fff'
            }]
          }, options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 10, usePointStyle: true } } }
          }
        });

        const pt = data.promiseTotals;
        mkChart('ch-promise', {
          type: 'doughnut', data: {
            labels: ['Kept', 'Broken', 'Partial', 'Awaiting'],
            datasets: [{
              data: [pt.kept, pt.broken, pt.partial, pt.pending],
              backgroundColor: [C.green, C.red, C.amber, C.blue], borderWidth: 2, borderColor: '#fff', hoverOffset: 4
            }]
          }, options: {
            responsive: true, maintainAspectRatio: false, cutout: '60%',
            plugins: { legend: { position: 'bottom', labels: { font: { size: 10 }, padding: 10, usePointStyle: true } } }
          }
        });

        const topEl = document.getElementById('rpt-top-overdue');
        topEl.innerHTML = data.topOverdue.map((p, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid #F8FAFC">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:10px;font-weight:700;width:18px;color:var(--muted)">${i + 1}</span>
        <div>
          <div style="font-size:12px;font-weight:600">${p.name}</div>
          <div style="font-size:10px;color:var(--muted)">${p.count} invoice(s)  max ${p.maxDays}d OD</div>
        </div>
      </div>
      <span style="font-size:12px;font-weight:700;color:var(--red)">${INR(p.amt)}</span>
    </div>`).join('');
      }


      // ============================================================
      // RENDER: FOLLOW-UPS (was missing)
      // ============================================================
      function renderFollowups() {
        const q = ((document.getElementById('fu-search') || {}).value || '').toLowerCase();
        const from = (document.getElementById('fu-from') || {}).value || '';
        const to = (document.getElementById('fu-to') || {}).value || '';
        const modeF = (document.getElementById('fu-mode-filter') || {}).value || '';

        let list = (DB.followups || []).filter(f => {
          if (q && !((f.partyName||'').toLowerCase().includes(q) || (f.notes||'').toLowerCase().includes(q) || (f.invoiceNo||'').toLowerCase().includes(q))) return false;
          if (modeF && f.mode !== modeF) return false;
          if (from || to) {
            const d = parseIST((f.datetime||'').split(' ')[0]);
            if (from && d && d < new Date(from)) return false;
            if (to && d && d > new Date(to + 'T23:59:59')) return false;
          }
          // filter pill
          const fp = (document.querySelector('.fpill.active[data-fu-filter]') || {}).dataset;
          const pill = fp && fp.fuFilter ? fp.fuFilter : '';
          if (pill === 'escalated' && f.escalated !== 'Yes') return false;
          if (pill === 'promise' && !f.promiseDate) return false;
          return true;
        }).sort((a, b) => (b.datetime || '').localeCompare(a.datetime || ''));

        _filtered.followups = list;
        txt('fu-sub', list.length + ' follow-up(s) logged');
        txt('fu-count-badge', list.length);

        const pg = _pState.followups || 1;
        const page = list.slice((pg - 1) * PER, pg * PER);
        txt('fu-info', ((pg-1)*PER+1) + '-' + Math.min(pg*PER, list.length) + ' of ' + list.length);
        _updatePager('fu', pg, list.length);

        const tbody = document.getElementById('fu-tbody');
        if (!tbody) return;
        if (!list.length) { tbody.innerHTML = emptyRow(9, 'No follow-ups found'); return; }

        tbody.innerHTML = page.map(f => {
          const bg = modeBg(f.mode);
          const pkColor = f.promiseKept === 'Yes' ? 'var(--green)' : f.promiseKept === 'No' ? 'var(--red)' : 'var(--amber)';
          return `<tr>
            <td style="font-size:12px;font-weight:600;cursor:pointer" onclick="openPartyModal('${escQ(f.partyID)}')">${f.partyName}</td>
            <td style="font-size:11px">${(f.datetime||'').split(' ')[0]}</td>
            <td><span style="background:${bg};font-size:10px;padding:2px 7px;border-radius:10px">${f.mode||'-'}</span></td>
            <td style="font-size:11px">${f.contactPerson||'-'}</td>
            <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escQ(f.notes)}">${f.notes||'-'}</td>
            <td class="num" style="font-size:11px">${f.promiseAmt > 0 ? INR(f.promiseAmt) : '-'}</td>
            <td style="font-size:11px">${f.promiseDate||'-'}</td>
            <td><span style="color:${pkColor};font-size:11px;font-weight:600">${f.promiseKept||'Pending'}</span></td>
            <td style="white-space:nowrap">
              ${f.promiseKept === 'Pending' ? `
                <button class="act-btn" style="background:#E6F4EA;color:var(--green);border-color:#81C995" onclick="updatePromise('${escQ(f.followUpID)}','Yes')" title="Mark Kept"><i class="fas fa-check"></i></button>
                <button class="act-btn" style="background:#FCE8E6;color:var(--red);border-color:#F6AEA9" onclick="updatePromise('${escQ(f.followUpID)}','No')" title="Mark Broken"><i class="fas fa-times"></i></button>
              ` : ''}
            </td>
          </tr>`;
        }).join('');
      }

      function setFUFilter(el, val) {
        document.querySelectorAll('.fpill[data-fu-filter]').forEach(p => p.classList.remove('active'));
        if (el) { el.classList.add('active'); el.dataset.fuFilter = val; }
        renderFollowups();
      }

      // ============================================================
      // RENDER: PROMISE TRACKER (was missing)
      // ============================================================
      function renderPromises() {
        const pill = (document.querySelector('.promise-pill.active') || {}).dataset;
        const filter = pill && pill.promiseFilter ? pill.promiseFilter : 'ALL';
        const from = ((document.getElementById('pt-from')||{}).value||'');
        const to   = ((document.getElementById('pt-to')||{}).value||'');
        const today = new Date(); today.setHours(0,0,0,0);

        const ptFrom = (document.getElementById('pt-from')||{}).value||'';
        const ptTo   = (document.getElementById('pt-to')||{}).value||'';
        let list = (DB.followups || []).filter(f => {
          if (!f.promiseAmt && !f.promiseDate) return false;
          if (ptFrom || ptTo) {
            const fd = parseIST((f.datetime||'').split(' ')[0]);
            if (ptFrom && fd && fd < new Date(ptFrom)) return false;
            if (ptTo   && fd && fd > new Date(ptTo+'T23:59:59')) return false;
          }
          if (filter === 'ALL') return true;
          if (filter === 'overdue-promise') {
            const pd = f.promiseDate ? parseIST(f.promiseDate) : null;
            return pd && pd < today && f.promiseKept === 'Pending';
          }
          return f.promiseKept === filter;
        }).sort((a, b) => (a.promiseDate||'').localeCompare(b.promiseDate||''));

        const kept = list.filter(f => f.promiseKept === 'Yes').length;
        const broken = list.filter(f => f.promiseKept === 'No').length;
        const partial = list.filter(f => f.promiseKept === 'Partial').length;
        const pending = list.filter(f => f.promiseKept === 'Pending').length;

        txt('pt-kept', kept); txt('pt-broken', broken); txt('pt-partial', partial); txt('pt-pending', pending);

        const tbody = document.getElementById('pt-tbody');
        if (!tbody) return;
        if (!list.length) { tbody.innerHTML = emptyRow(8, 'No promises found'); return; }

        tbody.innerHTML = list.map(f => {
          const pd = f.promiseDate ? parseIST(f.promiseDate) : null;
          const isOverdue = pd && pd < today && f.promiseKept === 'Pending';
          const pkColor = f.promiseKept === 'Yes' ? 'var(--green)' : f.promiseKept === 'No' ? 'var(--red)' : isOverdue ? 'var(--red)' : 'var(--amber)';
          return `<tr style="${isOverdue ? 'background:#FCE8E6' : ''}">
            <td style="font-size:12px;font-weight:600;cursor:pointer" onclick="openPartyModal('${escQ(f.partyID)}')">${f.partyName}</td>
            <td style="font-size:11px">${(f.datetime||'').split(' ')[0]}</td>
            <td><span style="font-size:10px">${f.mode||'-'}</span></td>
            <td class="num" style="font-weight:700;color:var(--green)">${INR(f.promiseAmt||0)}</td>
            <td style="font-size:11px;${isOverdue ? 'color:var(--red);font-weight:700' : ''}">${f.promiseDate||'-'}</td>
            <td><span style="color:${pkColor};font-size:11px;font-weight:600">${f.promiseKept||'Pending'}${isOverdue ? ' (OVERDUE)' : ''}</span></td>
            <td style="font-size:11px">${f.nextAction||'-'}</td>
            <td style="white-space:nowrap">
              ${f.promiseKept === 'Pending' ? `
                <button class="act-btn" style="background:#E6F4EA;color:var(--green);border-color:#81C995" onclick="updatePromise('${escQ(f.followUpID)}','Yes')" title="Kept"><i class="fas fa-check"></i></button>
                <button class="act-btn" style="background:#FCE8E6;color:var(--red);border-color:#F6AEA9" onclick="updatePromise('${escQ(f.followUpID)}','No')" title="Broken"><i class="fas fa-times"></i></button>
              ` : ''}
            </td>
          </tr>`;
        }).join('');
      }

      function setPromiseFilter(el, val) {
        document.querySelectorAll('.promise-pill').forEach(p => p.classList.remove('active'));
        if (el) { el.classList.add('active'); el.dataset.promiseFilter = val; }
        renderPromises();
      }

      // ============================================================
      // RENDER: DISCOUNT TO BE GIVEN
      // ============================================================
      function dtbgPage(d) {
        const list = _getDTBGList();
        _pState.discountTBG = Math.max(1, Math.min(_pState.discountTBG + d, Math.ceil(list.length / PER)));
        renderDiscountTBG();
      }
      function _getDTBGList() {
        const q = ((document.getElementById('dtbg-search')||{}).value||'').toLowerCase();
        const from = (document.getElementById('dtbg-from')||{}).value||'';
        const to   = (document.getElementById('dtbg-to')||{}).value||'';
        return (DB.payments||[]).filter(p => {
          if ((p.discountToBeGiven||0) <= 0) return false;
          if (q && !p.partyName.toLowerCase().includes(q) && !(p.paymentID||'').toLowerCase().includes(q)) return false;
          if (from || to) {
            const d = parseIST(p.paymentDate);
            if (from && d && d < new Date(from)) return false;
            if (to   && d && d > new Date(to+'T23:59:59')) return false;
          }
          return true;
        }).sort((a,b) => (parseIST(b.paymentDate)||0) - (parseIST(a.paymentDate)||0));
      }
      function renderDiscountTBG() {
        if (!window._canViewDTBG) { nav('dashboard'); return; }
        const list = _getDTBGList();
        const total = list.length;
        const pg = _pState.discountTBG;
        const page = list.slice((pg-1)*PER, pg*PER);
        const totalDTBG = list.reduce((s,p) => s+(p.discountToBeGiven||0), 0);
        txt('dtbg-sub', total + ' payments with pending discount');
        const badge = document.getElementById('dtbg-total-badge');
        if (badge) badge.textContent = INR(totalDTBG) + ' pending';
        txt('dtbg-info', total > 0 ? ((pg-1)*PER+1)+'-'+Math.min(pg*PER,total)+' of '+total : '0 records');
        _updatePager('dtbg', pg, total);
        const tbody = document.getElementById('dtbg-tbody');
        if (!tbody) return;
        tbody.innerHTML = page.length === 0
          ? emptyRow(10, 'No pending discount-to-be-given entries')
          : page.map(p => {
            const dtbg = p.discountToBeGiven || 0;
            const dg   = p.discountGiven || 0;
            return `<tr>
              <td style="font-family:monospace;font-size:11px;font-weight:600">${p.paymentID}</td>
              <td style="font-size:12px;font-weight:600;cursor:pointer" onclick="openPartyModal('${escQ(p.partyID)}')">${p.partyName}</td>
              <td style="font-size:11px">${p.paymentDate}</td>
              <td><span class="badge badge-pending" style="background:#E8F0FE;font-size:10px">${p.mode}</span></td>
              <td class="num" style="font-weight:700;color:var(--green)">${INR(p.amount)}</td>
              <td style="font-size:10px;color:var(--muted);max-width:120px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${p.appliedTo||'--'}</td>
              <td class="num" style="font-weight:800;color:#7C3AED;font-size:13px">${INR(dtbg)}</td>
              <td class="num" style="color:var(--green)">${dg > 0 ? INR(dg) : '--'}</td>
              <td style="font-size:10px;color:var(--muted)">${p.recordedBy||'--'}</td>
              <td><button class="act-btn ab-view" onclick="openPartyModal('${escQ(p.partyID)}')" title="View Party"><i class="fas fa-eye"></i></button></td>
            </tr>`;
          }).join('');
      }

      // ============================================================
      // RENDER: WRITE-OFFS
      // ============================================================
      function woPage(d) {
        const list = _getWriteOffList();
        _pState.writeoffs = Math.max(1, Math.min(_pState.writeoffs + d, Math.ceil(list.length / PER)));
        renderWriteOffs();
      }
      function _getWriteOffList() {
        const q = ((document.getElementById('wo-search')||{}).value||'').toLowerCase();
        const from = (document.getElementById('wo-from')||{}).value||'';
        const to   = (document.getElementById('wo-to')||{}).value||'';
        return (DB.invoices||[]).filter(inv => {
          if ((inv.writeOff||0) <= 0 && inv.status !== 'Written-Off') return false;
          if (q && !inv.partyName.toLowerCase().includes(q) && !inv.invoiceNo.toLowerCase().includes(q)) return false;
          if (from || to) {
            const d = parseIST(inv.invoiceDate);
            if (from && d && d < new Date(from)) return false;
            if (to   && d && d > new Date(to+'T23:59:59')) return false;
          }
          return true;
        }).sort((a,b) => (parseIST(b.invoiceDate)||0) - (parseIST(a.invoiceDate)||0));
      }
      function renderWriteOffs() {
        const list = _getWriteOffList();
        const total = list.length;
        const pg = _pState.writeoffs;
        const page = list.slice((pg-1)*PER, pg*PER);
        const totalWO = list.reduce((s,i) => s+(i.writeOff||0), 0);
        const parties = new Set(list.map(i=>i.partyID)).size;
        const today = new Date(); today.setHours(0,0,0,0);
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const thisMonthWO = list.filter(i => { const d = parseIST(i.invoiceDate); return d && d >= monthStart; }).reduce((s,i) => s+(i.writeOff||0), 0);
        txt('wo-sub', total + ' write-off invoices');
        const badge = document.getElementById('wo-total-badge');
        if (badge) badge.textContent = INR(totalWO) + ' written off';
        const stTotal = document.getElementById('wo-stat-total'); if(stTotal) stTotal.textContent = INR(totalWO);
        const stCount = document.getElementById('wo-stat-count'); if(stCount) stCount.textContent = total;
        const stPart  = document.getElementById('wo-stat-parties'); if(stPart) stPart.textContent = parties;
        const stMon   = document.getElementById('wo-stat-month'); if(stMon) stMon.textContent = INR(thisMonthWO);
        txt('wo-info', total > 0 ? ((pg-1)*PER+1)+'-'+Math.min(pg*PER,total)+' of '+total : '0 records');
        _updatePager('wo', pg, total);
        const tbody = document.getElementById('wo-tbody');
        if (!tbody) return;
        tbody.innerHTML = page.length === 0
          ? emptyRow(9, 'No write-offs found')
          : page.map(inv => {
            const wo = inv.writeOff || 0;
            const paid = inv.paidAmount || 0;
            const od = daysOD(inv);
            const remarksMatch = (inv.remarks||'').match(/WRITE-OFF: [\d.]+ - ([^|]+)/);
            const reason = remarksMatch ? remarksMatch[1].trim() : (inv.status === 'Written-Off' ? 'Written-Off' : '--');
            return `<tr style="background:#FEF7E0">
              <td style="font-family:monospace;font-size:11px;font-weight:600">${inv.invoiceNo}</td>
              <td style="font-size:12px;font-weight:600;cursor:pointer" onclick="openPartyModal('${escQ(inv.partyID)}')">${inv.partyName}</td>
              <td style="font-size:11px">${inv.invoiceDate}</td>
              <td style="font-size:11px${od > 0 ? ';color:var(--red)' : ''}">${inv.dueDate}</td>
              <td class="num">${INR(inv.billValue)}</td>
              <td class="num" style="color:var(--green)">${INR(paid)}</td>
              <td class="num" style="font-weight:800;color:#F9AB00;font-size:13px">${INR(wo)}</td>
              <td style="font-size:10px;color:var(--muted);max-width:150px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis" title="${escQ(reason)}">${reason}</td>
              <td><button class="act-btn ab-view" onclick="openPartyModal('${escQ(inv.partyID)}')" title="View Party"><i class="fas fa-eye"></i></button></td>
            </tr>`;
          }).join('');
      }

      // ============================================================
      // RENDER: ESCALATIONS (was missing)
      // ============================================================
      function renderEscalations() {
        const escFrom  = (document.getElementById('esc-from')||{}).value||'';
        const escTo    = (document.getElementById('esc-to')||{}).value||'';
        const escSearch= ((document.getElementById('esc-search')||{}).value||'').toLowerCase();
        const list = (DB.followups || []).filter(f => {
          if (f.escalated !== 'Yes') return false;
          if (escSearch && !f.partyName.toLowerCase().includes(escSearch)) return false;
          if (escFrom || escTo) {
            const fd = parseIST((f.datetime||'').split(' ')[0]);
            if (escFrom && fd && fd < new Date(escFrom)) return false;
            if (escTo   && fd && fd > new Date(escTo+'T23:59:59')) return false;
          }
          return true;
        }).sort((a, b) => (b.datetime||'').localeCompare(a.datetime||''));

        const kept = list.filter(f => f.promiseKept === 'Yes').length;
        const pending = list.filter(f => f.promiseKept === 'Pending' || !f.promiseKept).length;

        txt('esc-badge', list.length + ' escalated');
        txt('esc-count', list.length);
        txt('esc-outstanding', INR(list.reduce((s, f) => s + (f.outstandingAmt||0), 0)));
        txt('esc-kept', kept);
        txt('esc-pending', pending);

        const tbody = document.getElementById('esc-tbody');
        if (!tbody) return;
        if (!list.length) { tbody.innerHTML = emptyRow(9, 'No escalations found'); return; }

        tbody.innerHTML = list.map(f => {
          const pkColor = f.promiseKept === 'Yes' ? 'var(--green)' : f.promiseKept === 'No' ? 'var(--red)' : 'var(--amber)';
          return `<tr style="background:#FFF7F7">
            <td style="font-size:12px;font-weight:600;cursor:pointer" onclick="openPartyModal('${escQ(f.partyID)}')">${f.partyName}</td>
            <td style="font-size:11px">${(f.datetime||'').split(' ')[0]}</td>
            <td style="font-size:11px;font-weight:600;color:var(--red)">${f.escalatedTo||'Senior Mgmt'}</td>
            <td class="num" style="font-weight:700;color:var(--red)">${INR(f.outstandingAmt||0)}</td>
            <td style="font-size:11px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escQ(f.notes)}">${f.notes||'-'}</td>
            <td class="num">${f.promiseAmt > 0 ? INR(f.promiseAmt) : '-'}</td>
            <td style="font-size:11px">${f.promiseDate||'-'}</td>
            <td><span style="color:${pkColor};font-size:11px;font-weight:600">${f.promiseKept||'Pending'}</span></td>
            <td style="white-space:nowrap">
              <button class="act-btn ab-edit admin-only" onclick="openEditFollowUpModal('${escQ(f.followUpID)}')" title="Edit Follow-up"><i class="fas fa-edit"></i></button>
              <button class="act-btn ab-fu" onclick="openFUModalForParty('${escQ(f.partyID)}','')" title="Follow up"><i class="fas fa-phone-alt"></i></button>
            </td>
          </tr>`;
        }).join('');
      }


      // ============================================================
      // EDIT PARTY MODAL (Admin only) - FIX 15
      // ============================================================
      // ============================================================
      // EDIT INVOICE MODAL
      // ============================================================
      // ============================================================
      // EDIT INVOICE DRAWER
      // ============================================================
      let _editInvID = '';
      function openEditInvoiceModal(invoiceID) {
        if (!window._isAdmin) { Swal.fire('Access Denied','Only Admin can edit invoices.','error'); return; }
        const inv = (DB.invoices||[]).find(x => x.invoiceID === invoiceID);
        if (!inv) { Swal.fire('Error','Invoice not found.','error'); return; }
        _editInvID = invoiceID;

        document.getElementById('edit-inv-title').textContent = 'Edit Invoice: ' + inv.invoiceNo;
        document.getElementById('edit-inv-sub').textContent   = inv.partyName + '  ·  Due: ' + inv.dueDate;

        document.getElementById('edit-inv-body').innerHTML = `
          <div class="edit-section-title">Basic Info</div>
          <div class="edit-badge-row">
            <span style="color:var(--muted)">Invoice No</span>
            <span style="font-weight:700;font-family:monospace">${inv.invoiceNo}</span>
          </div>
          <div class="edit-badge-row">
            <span style="color:var(--muted)">Party</span>
            <span style="font-weight:600">${inv.partyName}</span>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Dates</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Invoice Date</label>
              <input id="ei-date" value="${inv.invoiceDate}" placeholder="dd/mm/yyyy">
              <span class="edit-hint">Format: DD/MM/YYYY</span>
            </div>
            <div class="edit-field">
              <label>Due Date <span style="color:var(--red)">*</span></label>
              <input id="ei-due" value="${inv.dueDate}" placeholder="dd/mm/yyyy">
            </div>
          </div>
          <div class="edit-field">
            <label>Due Days</label>
            <input id="ei-days" type="number" value="${inv.dueDays||0}">
            <span class="edit-hint">Credit period in days</span>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Financial Details</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Bill Value (₹) <span style="color:var(--red)">*</span></label>
              <input id="ei-bill" type="number" value="${inv.billValue}" oninput="updateNetCalc()">
            </div>
            <div class="edit-field">
              <label>Net Amount (₹)</label>
              <input id="ei-net" type="number" value="${inv.netAmount}" style="color:#1E8E3E;font-weight:600">
              <span class="edit-hint">Auto-calc or override</span>
            </div>
          </div>
          <div class="edit-grid-3">
            <div class="edit-field">
              <label>CGST (₹)</label>
              <input id="ei-cgst" type="number" value="${inv.cgst||0}" oninput="updateNetCalc()">
            </div>
            <div class="edit-field">
              <label>SGST (₹)</label>
              <input id="ei-sgst" type="number" value="${inv.sgst||0}" oninput="updateNetCalc()">
            </div>
            <div class="edit-field">
              <label>IGST (₹)</label>
              <input id="ei-igst" type="number" value="${inv.igst||0}" oninput="updateNetCalc()">
            </div>
          </div>
          <div class="edit-grid-3">
            <div class="edit-field">
              <label>TDS (₹)</label>
              <input id="ei-tcs" type="number" value="${inv.tcs||0}" oninput="updateNetCalc()">
            </div>
            <div class="edit-field">
              <label>Other Dedn (₹)</label>
              <input id="ei-other" type="number" value="${inv.otherDed||0}" oninput="updateNetCalc()">
            </div>
            <div class="edit-field">
              <label>TCS (₹)</label>
              <input id="ei-tcs2" type="number" value="0">
            </div>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Slab & Classification</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Cash Disc Slab</label>
              <select id="ei-slab">
                <option value="0" ${inv.slabPct==='0'||!inv.slabPct?'selected':''}>Nil (No Discount)</option>
                <option value="1" ${inv.slabPct==='1'?'selected':''}>1% Discount</option>
                <option value="1.5" ${inv.slabPct==='1.5'?'selected':''}>1.5% Discount</option>
              </select>
            </div>
            <div class="edit-field">
              <label>Status</label>
              <select id="ei-status">
                <option ${inv.status==='Pending'?'selected':''}>Pending</option>
                <option ${inv.status==='PartPaid'?'selected':''}>PartPaid</option>
                <option ${inv.status==='Paid'?'selected':''}>Paid</option>
                <option ${inv.status==='Written-Off'?'selected':''}>Written-Off</option>
                <option ${inv.status==='Cancelled'?'selected':''}>Cancelled</option>
              </select>
            </div>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Other Info</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Vehicle No</label>
              <input id="ei-vehicle" value="${inv.vehicleNo||''}" placeholder="Optional">
            </div>
            <div class="edit-field">
              <label>Head / Category</label>
              <input id="ei-head" value="${inv.head||''}" placeholder="Optional">
            </div>
          </div>
          <div class="edit-field">
            <label>Difference (₹) <span style="font-size:10px;color:#94A3B8;font-weight:400">— manually entered, shown in Invoices table</span></label>
            <input id="ei-diff" type="number" value="${inv.difference||0}" placeholder="0">
            <span class="edit-hint">Enter the difference amount if any discrepancy exists between expected and actual</span>
          </div>
          <div class="edit-field">
            <label>Remarks</label>
            <textarea id="ei-remarks">${inv.remarks||''}</textarea>
          </div>
        `;
        document.getElementById('edit-inv-overlay').classList.add('show');
        document.body.style.overflow = 'hidden';
      }

      function updateNetCalc() {
        const bill  = parseFloat(document.getElementById('ei-bill')?.value)  || 0;
        const cgst  = parseFloat(document.getElementById('ei-cgst')?.value)  || 0;
        const sgst  = parseFloat(document.getElementById('ei-sgst')?.value)  || 0;
        const igst  = parseFloat(document.getElementById('ei-igst')?.value)  || 0;
        const tcs   = parseFloat(document.getElementById('ei-tcs')?.value)   || 0;
        const other = parseFloat(document.getElementById('ei-other')?.value) || 0;
        const net   = bill - tcs - other;
        const netEl = document.getElementById('ei-net');
        if (netEl) netEl.value = Math.round(net);
      }

      function saveEditInvoice() {
        const bill = parseFloat(document.getElementById('ei-bill').value);
        const due  = document.getElementById('ei-due').value.trim();
        if (!bill || bill <= 0) { Swal.fire('Validation','Bill Value is required','warning'); return; }
        if (!due) { Swal.fire('Validation','Due Date is required','warning'); return; }
        const data = {
          invoiceID: _editInvID,
          invoiceDate: document.getElementById('ei-date').value.trim(),
          dueDate: due,
          dueDays: parseInt(document.getElementById('ei-days').value)||0,
          billValue: bill,
          netAmount: parseFloat(document.getElementById('ei-net').value)||bill,
          cgst: parseFloat(document.getElementById('ei-cgst').value)||0,
          sgst: parseFloat(document.getElementById('ei-sgst').value)||0,
          igst: parseFloat(document.getElementById('ei-igst').value)||0,
          tcs:  parseFloat(document.getElementById('ei-tcs').value)||0,
          otherDed: parseFloat(document.getElementById('ei-other').value)||0,
          slabPct: document.getElementById('ei-slab').value,
          status:  document.getElementById('ei-status').value,
          vehicleNo: document.getElementById('ei-vehicle').value.trim(),
          head: document.getElementById('ei-head').value.trim(),
          remarks: document.getElementById('ei-remarks').value.trim(),
          difference: parseFloat(document.getElementById('ei-diff').value) || 0
        };
        const btn = document.querySelector('#edit-inv-overlay .edit-drawer-footer .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
        google.script.run
          .withSuccessHandler(r => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
            if (r.success) {
              closeEditDrawer('inv');
              Swal.fire({ icon:'success', title:'Saved!', text:r.msg, timer:1800, showConfirmButton:false });
              _silentDataRefresh();
            } else Swal.fire('Error', r.error, 'error');
          })
          .withFailureHandler(e => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
            Swal.fire('Error', e.message, 'error');
          })
          .updateInvoice(data, URL_NAME);
      }

      // ============================================================
      // EDIT FOLLOW-UP DRAWER

      // ============================================================
      function openEditFollowUpModal(followUpID) {
        if (!window._isAdmin) { Swal.fire('Access Denied','Only Admin can edit follow-ups.','error'); return; }
        const f = (DB.followups||[]).find(x => x.followUpID === followUpID);
        if (!f) { Swal.fire('Error','Follow-up not found.','error'); return; }
        window._editFuID = followUpID;

        document.getElementById('edit-fu-title').textContent = 'Edit Follow-up: ' + f.followUpID;
        document.getElementById('edit-fu-sub').textContent   = f.partyName + '  ·  ' + f.datetime;

        document.getElementById('edit-fu-body').innerHTML = `
          <div class="edit-section-title">Follow-up Info</div>
          <div class="edit-badge-row">
            <span style="color:var(--muted)">Follow-up ID</span>
            <span style="font-weight:700;font-family:monospace">${f.followUpID}</span>
          </div>
          <div class="edit-badge-row">
            <span style="color:var(--muted)">Party</span>
            <span style="font-weight:600">${f.partyName}</span>
          </div>
          <div class="edit-badge-row">
            <span style="color:var(--muted)">Invoice</span>
            <span style="font-weight:600">${f.invoiceNo||'--'}</span>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Communication</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Mode</label>
              <select id="efu-mode">
                <option ${f.mode==='Phone Call'?'selected':''}>Phone Call</option>
                <option ${f.mode==='WhatsApp'?'selected':''}>WhatsApp</option>
                <option ${f.mode==='Email'?'selected':''}>Email</option>
                <option ${f.mode==='Visit'?'selected':''}>Visit</option>
                <option ${f.mode==='Meeting'?'selected':''}>Meeting</option>
                <option ${f.mode==='Other'?'selected':''}>Other</option>
              </select>
            </div>
            <div class="edit-field">
              <label>Contact Person</label>
              <input id="efu-contact" value="${f.contactPerson||''}" placeholder="Name">
            </div>
          </div>
          <div class="edit-field">
            <label>Notes / Conversation</label>
            <textarea id="efu-notes" style="min-height:90px">${f.notes||''}</textarea>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Promise Details</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Promise Amount (₹)</label>
              <input id="efu-pamt" type="number" value="${f.promiseAmt||0}">
            </div>
            <div class="edit-field">
              <label>Promise Date</label>
              <input id="efu-pdate" value="${f.promiseDate||''}" placeholder="dd/mm/yyyy">
            </div>
          </div>
          <div class="edit-field">
            <label>Promise Kept</label>
            <select id="efu-kept">
              <option ${f.promiseKept==='Pending'?'selected':''}>Pending</option>
              <option ${f.promiseKept==='Yes'?'selected':''}>Yes</option>
              <option ${f.promiseKept==='No'?'selected':''}>No</option>
              <option ${f.promiseKept==='Partial'?'selected':''}>Partial</option>
            </select>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Action & Escalation</div>
          <div class="edit-field">
            <label>Next Action</label>
            <input id="efu-action" value="${f.nextAction||''}" placeholder="e.g. Call again, Send reminder">
          </div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Next Action Date</label>
              <input id="efu-next" value="${f.nextActionDate||''}" placeholder="dd/mm/yyyy">
            </div>
            <div class="edit-field">
              <label>Priority</label>
              <select id="efu-pri">
                <option ${f.priority==='Low'?'selected':''}>Low</option>
                <option ${f.priority==='Medium'?'selected':''}>Medium</option>
                <option ${f.priority==='High'?'selected':''}>High</option>
                <option ${f.priority==='Critical'?'selected':''}>Critical</option>
              </select>
            </div>
          </div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Escalated</label>
              <select id="efu-esc">
                <option ${f.escalated==='No'?'selected':''}>No</option>
                <option ${f.escalated==='Yes'?'selected':''}>Yes</option>
              </select>
            </div>
            <div class="edit-field">
              <label>Escalated To</label>
              <input id="efu-escto" value="${f.escalatedTo||''}" placeholder="Name / Dept">
            </div>
          </div>
        `;
        document.getElementById('edit-fu-overlay').classList.add('show');
        document.body.style.overflow = 'hidden';
      }

      function saveEditFollowUp() {
        const data = {
          followUpID: window._editFuID,
          mode: document.getElementById('efu-mode').value,
          contactPerson: document.getElementById('efu-contact').value.trim(),
          notes: document.getElementById('efu-notes').value.trim(),
          promiseAmt: parseFloat(document.getElementById('efu-pamt').value)||0,
          promiseDate: document.getElementById('efu-pdate').value.trim(),
          promiseKept: document.getElementById('efu-kept').value,
          nextAction: document.getElementById('efu-action').value.trim(),
          nextActionDate: document.getElementById('efu-next').value.trim(),
          priority: document.getElementById('efu-pri').value,
          escalated: document.getElementById('efu-esc').value,
          escalatedTo: document.getElementById('efu-escto').value.trim()
        };
        const btn = document.querySelector('#edit-fu-overlay .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
        google.script.run
          .withSuccessHandler(r => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
            if (r.success) {
              closeEditDrawer('fu');
              Swal.fire({ icon:'success', title:'Saved!', text:r.msg, timer:1800, showConfirmButton:false });
              _silentDataRefresh();
            } else Swal.fire('Error', r.error, 'error');
          })
          .withFailureHandler(e => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
            Swal.fire('Error', e.message, 'error');
          })
          .updateFollowUp(data, URL_NAME);
      }

      function openEditPartyModal(partyID) {
        if (!window._isAdmin) { Swal.fire('Access Denied','Only Admin can edit parties.','error'); return; }
        const p = (DB.parties||[]).find(x => x.partyID === partyID);
        if (!p) { Swal.fire('Error','Party not found.','error'); return; }
        window._editPartyID = partyID;

        document.getElementById('edit-party-title').textContent = 'Edit Party: ' + p.name;
        document.getElementById('edit-party-sub').textContent   = p.partyCode + '  ·  ' + (p.city||'') + (p.state ? ', '+p.state : '');

        document.getElementById('edit-party-body').innerHTML = `
          <div class="edit-section-title">Basic Details</div>
          <div class="edit-field">
            <label>Party Name <span style="color:var(--red)">*</span></label>
            <input id="ep-name" value="${p.name}">
          </div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Party Code</label>
              <input id="ep-code" value="${p.partyCode||''}">
            </div>
            <div class="edit-field">
              <label>Category</label>
              <select id="ep-cat">
                <option ${p.category==='A'?'selected':''}>A</option>
                <option ${p.category==='B'||!p.category?'selected':''}>B</option>
                <option ${p.category==='C'?'selected':''}>C</option>
              </select>
            </div>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Location</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>City</label>
              <input id="ep-city" value="${p.city||''}">
            </div>
            <div class="edit-field">
              <label>State</label>
              <input id="ep-state" value="${p.state||''}">
            </div>
          </div>
          <div class="edit-field">
            <label>Address</label>
            <textarea id="ep-addr" style="min-height:60px">${p.address||''}</textarea>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Contact</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Phone 1</label>
              <input id="ep-phone" value="${p.phone||''}" placeholder="Mobile">
            </div>
            <div class="edit-field">
              <label>Phone 2</label>
              <input id="ep-phone2" value="${p.phone2||''}" placeholder="Alternate">
            </div>
          </div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Email</label>
              <input id="ep-email" type="email" value="${p.email||''}" placeholder="email@domain.com">
            </div>
            <div class="edit-field">
              <label>Contact Person</label>
              <input id="ep-contact" value="${p.contact||''}" placeholder="Name">
            </div>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Legal & Financial</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>GSTIN</label>
              <input id="ep-gstin" value="${p.gstin||''}" placeholder="15-digit GST">
            </div>
            <div class="edit-field">
              <label>PAN</label>
              <input id="ep-pan" value="${p.pan||''}" placeholder="10-digit PAN">
            </div>
          </div>
          <div class="edit-field">
            <label>Credit Limit (₹)</label>
            <input id="ep-credit" type="number" value="${p.creditLimit||0}">
          </div>

          <div class="edit-section-title" style="margin-top:4px">Payment Terms & Slab</div>
          <div class="edit-grid-3">
            <div class="edit-field">
              <label>1.5% Slab (days)</label>
              <input id="ep-d15" type="number" value="${p.days15!=null?p.days15:''}" placeholder="leave blank">
              <span class="edit-hint">Blank = not applicable</span>
            </div>
            <div class="edit-field">
              <label>1% Slab (days)</label>
              <input id="ep-d1" type="number" value="${p.days1!=null?p.days1:''}" placeholder="leave blank">
            </div>
            <div class="edit-field">
              <label>Nil Slab (days)</label>
              <input id="ep-d0" type="number" value="${p.days0!=null?p.days0:''}" placeholder="e.g. 30">
            </div>
          </div>
          <div class="edit-field">
            <label>Payment Terms</label>
            <input id="ep-terms" value="${p.payTerms||''}" placeholder="e.g. Net 30">
          </div>

          <div class="edit-section-title" style="margin-top:4px">Other</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Head</label>
              <input id="ep-head" value="${p.head||''}" placeholder="e.g. Iron Store">
            </div>
            <div class="edit-field">
              <label>Status</label>
              <select id="ep-status">
                <option ${p.status==='Active'?'selected':''}>Active</option>
                <option ${p.status==='Inactive'?'selected':''}>Inactive</option>
                <option ${p.status==='Blacklisted'?'selected':''}>Blacklisted</option>
              </select>
            </div>
          </div>
          <div class="edit-field">
            <label>Notes</label>
            <textarea id="ep-notes" style="min-height:60px">${p.notes||''}</textarea>
          </div>
        `;
        document.getElementById('edit-party-overlay').classList.add('show');
        document.body.style.overflow = 'hidden';
      }

      // ============================================================
      // RECALC PARTY INVOICES — Auto-created party fix
      // ============================================================

      function _showRecalcOffer(partyID, preview) {
        const rows = preview.invoices.map(inv =>
          `<tr style="font-size:11px">
            <td style="font-family:monospace;padding:4px 8px">${inv.invoiceNo}</td>
            <td style="padding:4px 8px;color:var(--muted)">${inv.invoiceDate}</td>
            <td style="padding:4px 8px;color:var(--red)">${inv.oldDueDate}</td>
            <td style="padding:4px 8px;color:#1E8E3E;font-weight:600">${inv.newDueDate}</td>
            <td style="padding:4px 8px;color:var(--muted)">${inv.oldSlab === '0' ? 'Nil' : inv.oldSlab + '%'}</td>
            <td style="padding:4px 8px;color:#1E8E3E;font-weight:600">${inv.newSlab === '0' ? 'Nil' : inv.newSlab + '%'}</td>
          </tr>`
        ).join('');

        Swal.fire({
          title: '⚠️ Fix Invoice Calculations?',
          html: `
            <div style="text-align:left;font-size:13px;margin-bottom:12px">
              <b>${preview.count} pending invoice(s)</b> for <b>${preview.partyName}</b> were created when
              this party had default values. Now that correct terms are saved, you can update their
              due dates and slab — <span style="color:var(--red)">only Pending invoices with zero payment are eligible.</span>
            </div>
            <div style="max-height:220px;overflow-y:auto;border:1px solid #E2E8F0;border-radius:8px">
              <table style="width:100%;border-collapse:collapse">
                <thead style="background:#F8FAFC;position:sticky;top:0">
                  <tr style="font-size:10px;color:#64748B">
                    <th style="padding:6px 8px;text-align:left">Invoice</th>
                    <th style="padding:6px 8px;text-align:left">Bill Date</th>
                    <th style="padding:6px 8px;text-align:left">Old Due</th>
                    <th style="padding:6px 8px;text-align:left">New Due</th>
                    <th style="padding:6px 8px;text-align:left">Old Slab</th>
                    <th style="padding:6px 8px;text-align:left">New Slab</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
            <div style="margin-top:12px;font-size:11px;color:#94A3B8;text-align:left">
              <i class="fas fa-info-circle"></i>
              Already-paid, PartPaid, and older invoices will NOT be touched.
              A note will be added to each updated invoice's remarks.
            </div>
          `,
          icon: 'question',
          showCancelButton: true,
          confirmButtonText: '<i class="fas fa-sync-alt"></i> Yes, Update ' + preview.count + ' Invoice(s)',
          cancelButtonText: 'No, Keep As-Is',
          confirmButtonColor: '#1E8E3E',
          cancelButtonColor: '#64748B',
          width: 700
        }).then(result => {
          if (result.isConfirmed) {
            Swal.fire({ title: 'Updating...', didOpen: () => Swal.showLoading(), background: '#0F172A', color: '#fff' });
            google.script.run
              .withSuccessHandler(r => {
                if (r.success) {
                  Swal.fire({ icon:'success', title:'Done!', text:r.msg, timer:2500, showConfirmButton:false });
                  _silentDataRefresh();
                } else Swal.fire('Error', r.error, 'error');
              })
              .withFailureHandler(e => Swal.fire('Error', e.message, 'error'))
              .recalcPartyInvoices(partyID, URL_NAME);
          } else {
            Swal.fire({ icon:'success', title:'Party Updated!', text:'Invoice dates kept as-is.', timer:2000, showConfirmButton:false });
          }
        });
      }

      function saveEditParty() {
        const name = document.getElementById('ep-name').value.trim();
        if (!name) { Swal.fire('Validation','Party name is required','warning'); return; }
        const data = {
          partyID: window._editPartyID,
          partyName: name,
          partyCode: document.getElementById('ep-code').value.trim(),
          category:  document.getElementById('ep-cat').value,
          city:      document.getElementById('ep-city').value.trim(),
          state:     document.getElementById('ep-state').value.trim(),
          address:   document.getElementById('ep-addr').value.trim(),
          phone:     document.getElementById('ep-phone').value.trim(),
          phone2:    document.getElementById('ep-phone2').value.trim(),
          email:     document.getElementById('ep-email').value.trim(),
          contact:   document.getElementById('ep-contact').value.trim(),
          gstin:     document.getElementById('ep-gstin').value.trim(),
          pan:       document.getElementById('ep-pan').value.trim(),
          creditLimit: document.getElementById('ep-credit').value,
          days15:    document.getElementById('ep-d15').value || null,
          days1:     document.getElementById('ep-d1').value  || null,
          days0:     document.getElementById('ep-d0').value  || null,
          payTerms:  document.getElementById('ep-terms').value.trim(),
          head:      document.getElementById('ep-head').value.trim(),
          status:    document.getElementById('ep-status').value,
          notes:     document.getElementById('ep-notes').value.trim()
        };
        const btn = document.querySelector('#edit-party-overlay .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
        google.script.run
          .withSuccessHandler(r => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
            if (r.success) {
              closeEditDrawer('party');
              _silentDataRefresh();
              // Check if this was an auto-created party — offer to recalc invoices
              const savedPartyID = data.partyID;
              const savedData    = data;
              google.script.run
                .withSuccessHandler(prev => {
                  if (prev.success && prev.count > 0) {
                    // Show recalc offer
                    _showRecalcOffer(savedPartyID, prev);
                  } else {
                    Swal.fire({ icon:'success', title:'Party Updated!', text:r.msg, timer:2000, showConfirmButton:false });
                  }
                })
                .withFailureHandler(() => {
                  Swal.fire({ icon:'success', title:'Party Updated!', text:r.msg, timer:2000, showConfirmButton:false });
                })
                .previewRecalcPartyInvoices(savedPartyID);
            } else Swal.fire('Error', r.error, 'error');
          })
          .withFailureHandler(e => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
            Swal.fire('Error', e.message, 'error');
          })
          .updateParty(data, URL_NAME);
      }

      // ============================================================
      // EDIT PAYMENT DRAWER
      // ============================================================
      let _editPayID = null;

      function openEditPaymentModal(paymentID) {
        if (!window._isAdmin) { Swal.fire('Access Denied', 'Only Admin can edit payments.', 'error'); return; }
        const p = (DB.payments || []).find(x => x.paymentID === paymentID);
        if (!p) { Swal.fire('Error', 'Payment not found.', 'error'); return; }
        _editPayID = paymentID;
        document.getElementById('edit-pay-title').textContent = 'Edit Payment: ' + p.paymentID;
        document.getElementById('edit-pay-sub').textContent   = p.partyName + '  ·  ' + p.paymentDate;

        const toInput = s => {
          if (!s) return '';
          const parts = s.split('/');
          if (parts.length === 3) return parts[2] + '-' + parts[1].padStart(2,'0') + '-' + parts[0].padStart(2,'0');
          return s;
        };

        document.getElementById('edit-pay-body').innerHTML = `
          <div class="edit-section-title">Payment Info</div>
          <div class="edit-badge-row">
            <span style="color:var(--muted)">Payment ID</span>
            <span style="font-weight:700;font-family:monospace">${p.paymentID}</span>
          </div>
          <div class="edit-badge-row">
            <span style="color:var(--muted)">Party</span>
            <span style="font-weight:600">${p.partyName}</span>
          </div>
          <div class="edit-badge-row">
            <span style="color:var(--muted)">Applied To</span>
            <span style="font-size:11px;font-family:monospace">${p.appliedTo || '--'}</span>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Date & Amount</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Payment Date <span style="color:var(--red)">*</span></label>
              <input id="ep-date" type="date" value="${toInput(p.paymentDate)}">
            </div>
            <div class="edit-field">
              <label>Amount (₹) <span style="color:var(--red)">*</span></label>
              <input id="ep-amount" type="number" value="${p.amount || 0}">
            </div>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Payment Details</div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Mode</label>
              <select id="ep-mode">
                ${['RTGS','NEFT','IMPS','Cheque','Cash','UPI','DD','Other'].map(m =>
                  '<option' + (p.mode===m?' selected':'') + '>' + m + '</option>').join('')}
              </select>
            </div>
            <div class="edit-field">
              <label>Reference / UTR No</label>
              <input id="ep-ref" value="${p.refNo || ''}" placeholder="UTR / Cheque No">
            </div>
          </div>
          <div class="edit-grid-2">
            <div class="edit-field">
              <label>Bank Name</label>
              <input id="ep-bank" value="${p.bankName || ''}" placeholder="Optional">
            </div>
            <div class="edit-field">
              <label>Cheque Date</label>
              <input id="ep-cheque-date" type="date" value="${toInput(p.chequeDate || '')}">
            </div>
          </div>
          <div class="edit-field">
            <label>Cheque Status</label>
            <select id="ep-cheque-status">
              <option value="" ${!p.chequeStatus ? 'selected' : ''}>-- N/A --</option>
              ${['Cleared','Pending','Bounced'].map(s =>
                '<option' + (p.chequeStatus===s?' selected':'') + '>' + s + '</option>').join('')}
            </select>
          </div>

          <div class="edit-section-title" style="margin-top:4px">Deductions</div>
          <div class="edit-grid-3">
            <div class="edit-field">
              <label>TDS Deducted (₹)</label>
              <input id="ep-tds" type="number" value="${p.tdsDeducted || 0}">
            </div>
            <div class="edit-field">
              <label>Discount Given (₹)</label>
              <input id="ep-disc" type="number" value="${p.discountGiven || 0}">
            </div>
            <div class="edit-field">
              <label>Discount TBG (₹)</label>
              <input id="ep-dtbg" type="number" value="${p.discountToBeGiven || 0}">
            </div>
          </div>
          <div class="edit-field">
            <label>Remarks</label>
            <textarea id="ep-remarks">${p.remarks || ''}</textarea>
          </div>
        `;
        document.getElementById('edit-pay-overlay').classList.add('show');
        document.body.style.overflow = 'hidden';
      }

      function saveEditPayment() {
        const dateVal = document.getElementById('ep-date').value;
        const amount  = parseFloat(document.getElementById('ep-amount').value);
        if (!dateVal) { Swal.fire('Validation', 'Payment Date is required', 'warning'); return; }
        if (!amount || amount < 0) { Swal.fire('Validation', 'Amount must be 0 or more', 'warning'); return; }

        const fmtDateStr = s => {
          if (!s) return '';
          const p = s.split('-');
          return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : s;
        };

        const data = {
          paymentID:          _editPayID,
          paymentDate:        fmtDateStr(dateVal),
          amount,
          mode:               document.getElementById('ep-mode').value,
          refNo:              document.getElementById('ep-ref').value.trim(),
          bankName:           document.getElementById('ep-bank').value.trim(),
          chequeDate:         fmtDateStr(document.getElementById('ep-cheque-date').value),
          chequeStatus:       document.getElementById('ep-cheque-status').value,
          tdsDeducted:        parseFloat(document.getElementById('ep-tds').value)  || 0,
          discountGiven:      parseFloat(document.getElementById('ep-disc').value) || 0,
          discountToBeGiven:  parseFloat(document.getElementById('ep-dtbg').value) || 0,
          remarks:            document.getElementById('ep-remarks').value.trim()
        };

        const btn = document.querySelector('#edit-pay-overlay .edit-drawer-footer .btn-primary');
        if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...'; }
        google.script.run
          .withSuccessHandler(r => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
            if (r.success) {
              closeEditDrawer('pay');
              Swal.fire({ icon:'success', title:'Saved!', text:r.msg, timer:1800, showConfirmButton:false });
              _silentDataRefresh();
            } else Swal.fire('Error', r.error, 'error');
          })
          .withFailureHandler(e => {
            if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fas fa-save"></i> Save Changes'; }
            Swal.fire('Error', e.message, 'error');
          })
          .updatePayment(data, URL_NAME);
      }

      function closeEditDrawer(type) {
        const ids = { inv:'edit-inv-overlay', party:'edit-party-overlay', fu:'edit-fu-overlay', pay:'edit-pay-overlay' };
        const el = document.getElementById(ids[type]);
        if (el) el.classList.remove('show');
        document.body.style.overflow = '';
      }




      function clearODFilter() {
        const s = document.getElementById('od-search'); if(s) s.value='';
        const p = document.getElementById('od-party-filter-inp'); if(p) p.value='';
        renderOverdue();
      }

      // Searchable party filter helper
      function _buildPartyDatalist(listId) {
        let dl = document.getElementById(listId);
        if (!dl) { dl = document.createElement('datalist'); dl.id = listId; document.body.appendChild(dl); }
        dl.innerHTML = (DB.parties||[]).filter(p=>p.status==='Active')
          .map(p=>`<option value="${p.name}" data-id="${p.partyID}">`).join('');
      }
      function _getPartyIDFromName(name, fallbackSelId) {
        // First try datalist match
        const p = (DB.parties||[]).find(x => x.name.toLowerCase() === (name||'').toLowerCase().trim());
        if (p) return p.partyID;
        // fallback: direct select value
        const sel = document.getElementById(fallbackSelId);
        return sel ? sel.value : '';
      }
      function clearDateFilter(prefix) {
        const fromEl = document.getElementById(prefix + '-from');
        const toEl   = document.getElementById(prefix + '-to');
        const searchEl= document.getElementById(prefix + '-search');
        if (fromEl)   fromEl.value  = '';
        if (toEl)     toEl.value    = '';
        if (searchEl) searchEl.value = '';
        try { sdReset(prefix + '-party-sd', 'All Parties'); } catch(e) {}
        const renderMap = {
          inv: renderInvoices, pay: renderPayments, fu: renderFollowups,
          sp: renderShortPay, lp: renderLatePay,
          pt: renderPromises, esc: renderEscalations,
          dtbg: renderDiscountTBG, wo: renderWriteOffs,
          s15: ()=>renderSlabDue('15'), s1: ()=>renderSlabDue('1'), sNil: ()=>renderSlabDue('Nil')
        };
        if (renderMap[prefix]) renderMap[prefix]();
      }

      function _silentDataRefresh() {
        google.script.run
          .withSuccessHandler(data => {
            if (!data || !data.success) return;
            DB = data;
            _updateBadges();
            _populateFilters();
            _buildAllPartySS();
            _reRenderCurrent();
          })
          .getAllData((USER && USER.name) || URL_NAME);
      }

      function doLogout() {
        Swal.fire({
          title: 'Sign Out?',
          text: 'Are you sure you want to sign out of ' + (USER.name || 'your account') + '?',
          icon: 'question', showCancelButton: true,
          confirmButtonColor: C.red, cancelButtonColor: '#374151',
          confirmButtonText: 'Yes, Sign Out', cancelButtonText: 'Cancel',
          background: '#0F172A', color: '#E2E8F0'
        }).then(r => {
          if (!r.isConfirmed) return;
          Swal.fire({ title: 'Signing out...', allowOutsideClick: false, didOpen: () => Swal.showLoading(), background: '#0F172A', color: '#E2E8F0' });
          try{localStorage.removeItem('fresko_user');}catch(e){}
          _user=null; window.location.reload();
        });
      }

      (function() {
        if (typeof XLSX === 'undefined') {
          var script = document.createElement('script');
          script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
          document.head.appendChild(script);
        }
      })();

      function toggleDarkMode() {
        document.body.classList.toggle('dark');
        const icon = document.getElementById('theme-icon');
        if (document.body.classList.contains('dark')) {
          icon.classList.remove('fa-moon');
          icon.classList.add('fa-sun');
        } else {
          icon.classList.remove('fa-sun');
          icon.classList.add('fa-moon');
        }
      }

      // ════════════════════════════════════════════════════════════════
      //  PURCHASE MODULE
      // ════════════════════════════════════════════════════════════════

      let _purPage = 0;
      const PUR_PAGE_SIZE = 50;
      let _purParsed = [];   // parsed rows waiting to upload
      let _purFiltered = []; // filtered rows for table

      // ── Load purchase data from backend ─────────────────────────────
      function loadPurchaseData(cb) {
        google.script.run
          .withSuccessHandler(function(r) {
            if (r && r.success) {
              DB.purchases        = r.purchases  || [];
              DB.purchaseVendors  = r.vendors    || [];
            }
            if (cb) cb();
          })
          .withFailureHandler(function() { if (cb) cb(); })
          .getPurchaseData();
      }

      // ── VIEW: Purchase Register ──────────────────────────────────────
      function renderPurchase() {
        if (!DB.purchases.length) {
          loadPurchaseData(function() { _doPurchaseRender(); });
        } else {
          _doPurchaseRender();
        }
      }

      function _doPurchaseRender() {
        var from    = document.getElementById('pur-from')  && document.getElementById('pur-from').value;
        var to      = document.getElementById('pur-to')    && document.getElementById('pur-to').value;
        var vendor  = (document.getElementById('pur-vendor') ? document.getElementById('pur-vendor').value : '').toLowerCase().trim();
        var item    = (document.getElementById('pur-item')   ? document.getElementById('pur-item').value   : '').toLowerCase().trim();

        var data = (DB.purchases || []).filter(function(p) {
          if (p.entryType === 'DAYTOTAL' || p.entryType === 'SUMMARY') return false;
          if (from && p.purchaseDate && p.purchaseDate < _ddmmToISO(from)) return false;
          if (to   && p.purchaseDate && p.purchaseDate > _ddmmToISO(to))   return false;
          if (vendor && p.vendorName.toLowerCase().indexOf(vendor) < 0)    return false;
          if (item   && p.itemName.toLowerCase().indexOf(item)     < 0)    return false;
          return true;
        });
        _purFiltered = data;
        _purPage = 0;
        _renderPurchasePage();

        // Summary cards
        var totalAmt  = data.reduce(function(s,p){ return s + (p.netAmount||0); }, 0);
        var vendors   = new Set(data.map(function(p){ return p.vendorName; })).size;
        var items     = new Set(data.map(function(p){ return p.itemName; })).size;
        var totalWgt  = data.reduce(function(s,p){ return s + (p.wgt||0); }, 0);
        var cards = [
          { label:'Total Net Amount', val:'₹'+_fmt(totalAmt), icon:'fa-rupee-sign', color:'#005F73' },
          { label:'Entries', val:data.length.toLocaleString('en-IN'), icon:'fa-list', color:'#1E8E3E' },
          { label:'Vendors', val:vendors, icon:'fa-store', color:'#9333ea' },
          { label:'Total Weight (KG)', val:_fmt(totalWgt)+' kg', icon:'fa-weight', color:'#D97706' },
        ];
        var sc = document.getElementById('pur-summary-cards');
        if (sc) sc.innerHTML = cards.map(function(c) {
          return '<div class="stat-card" style="border-left:3px solid '+c.color+'"><div class="stat-icon" style="color:'+c.color+'"><i class="fas '+c.icon+'"></i></div><div class="stat-val" style="color:'+c.color+'">'+c.val+'</div><div class="stat-label">'+c.label+'</div></div>';
        }).join('');
      }

      function _renderPurchasePage() {
        var tbody  = document.getElementById('pur-tbody');
        var empty  = document.getElementById('pur-empty');
        var pager  = document.getElementById('pur-pager');
        var pgInfo = document.getElementById('pur-pager-info');
        if (!tbody) return;

        var data   = _purFiltered;
        var total  = data.length;
        var pages  = Math.ceil(total / PUR_PAGE_SIZE);
        var start  = _purPage * PUR_PAGE_SIZE;
        var slice  = data.slice(start, start + PUR_PAGE_SIZE);

        if (!total) {
          tbody.innerHTML = '';
          if (empty) empty.style.display = 'flex';
          if (pager) pager.style.display = 'none';
          return;
        }
        if (empty) empty.style.display = 'none';
        if (pager) pager.style.display = 'flex';
        if (pgInfo) pgInfo.textContent = (start+1)+'–'+Math.min(start+PUR_PAGE_SIZE, total)+' of '+total;
        document.getElementById('pur-prev').disabled = _purPage === 0;
        document.getElementById('pur-next').disabled = _purPage >= pages-1;

        tbody.innerHTML = slice.map(function(p) {
          var rowCls = p.entryType === 'DAYTOTAL' ? 'style="background:#F0FDF4;font-weight:700"' : '';
          return '<tr '+rowCls+'><td>'+_fmtDisplay(p.purchaseDate)+'</td>'+
            '<td>'+esc(p.vendorName)+'</td>'+
            '<td>'+esc(p.itemName)+'</td>'+
            '<td><span class="badge">'+esc(p.category||'—')+'</span></td>'+
            '<td style="text-align:right">'+_fmt(p.qty)+'</td>'+
            '<td>'+esc(p.unit)+'</td>'+
            '<td style="text-align:right">'+_fmt(p.wgt)+'</td>'+
            '<td style="text-align:right">'+_fmt(p.rate)+'</td>'+
            '<td style="text-align:right">₹'+_fmt(p.amount)+'</td>'+
            '<td style="text-align:right;font-weight:600;color:var(--primary)">₹'+_fmt(p.netAmount)+'</td>'+
            '<td>'+esc(p.billNo||'—')+'</td>'+
            '<td>'+esc(p.remarks||'—')+'</td>'+
            '<td class="muted" style="font-size:10px">'+esc(p.enteredBy)+'</td></tr>';
        }).join('');
      }

      function purPage(dir) {
        var pages = Math.ceil(_purFiltered.length / PUR_PAGE_SIZE);
        _purPage = Math.max(0, Math.min(pages-1, _purPage + dir));
        _renderPurchasePage();
      }

      function clearPurchaseFilters() {
        ['pur-from','pur-to','pur-vendor','pur-item'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
        renderPurchase();
      }

      // Helper: dd/mm/yyyy or yyyy-mm-dd to ISO for comparison
      function _ddmmToISO(s) {
        if (!s) return '';
        if (s.indexOf('-') === 4) return s; // already yyyy-mm-dd
        var p = s.split('/');
        if (p.length === 3) return p[2]+'-'+p[1].padStart(2,'0')+'-'+p[0].padStart(2,'0');
        return s;
      }
      function _fmtDisplay(s) {
        if (!s) return '—';
        if (s.indexOf('/') >= 0) return s;
        var p = s.split('-'); if(p.length===3) return p[2]+'/'+p[1]+'/'+p[0];
        return s;
      }

      // ── VIEW: Purchase Vendors ───────────────────────────────────────
      function renderPurchaseVendors() {
        if (!DB.purchaseVendors.length) {
          loadPurchaseData(function() { _doPVendRender(); });
        } else { _doPVendRender(); }
      }
      function _doPVendRender() {
        var tbody = document.getElementById('pvend-tbody');
        var empty = document.getElementById('pvend-empty');
        var data  = DB.purchaseVendors || [];
        if (!data.length) {
          if(tbody) tbody.innerHTML='';
          if(empty) empty.style.display='flex';
          return;
        }
        if(empty) empty.style.display='none';
        if(tbody) tbody.innerHTML = data.map(function(v,i) {
          return '<tr><td>'+(i+1)+'</td><td class="muted" style="font-size:11px">'+esc(v.vendorID)+'</td>'+
            '<td style="font-weight:600">'+esc(v.vendorName)+'</td>'+
            '<td>'+esc(v.category||'—')+'</td><td>'+esc(v.phone||'—')+'</td>'+
            '<td><span class="badge '+(v.status==='Active'?'green':'red')+'">'+esc(v.status)+'</span></td>'+
            '<td class="muted" style="font-size:11px">'+esc(v.addedBy)+'</td>'+
            '<td class="muted" style="font-size:11px">'+esc(v.addedOn)+'</td></tr>';
        }).join('');
      }

      // ── Vendor select/search for Add Purchase form ───────────────────
      function _buildPurVendorSS() {
        var wrap = document.getElementById('pf-vendor-ss-wrap');
        if (!wrap) return;
        var vendors = DB.purchaseVendors || [];
        // Build a simple datalist-backed input
        wrap.innerHTML = '<input type="text" id="pf-vendor-input" class="form-ctrl" placeholder="Select or type vendor name..." list="pf-vendor-list" style="width:100%">' +
          '<datalist id="pf-vendor-list">' + vendors.map(function(v){ return '<option value="'+esc(v.vendorName)+'">'; }).join('') + '</datalist>';
      }

      // ── ADD PURCHASE ENTRY (manual form) ────────────────────────────
      function calcPurAmt() {
        var qty  = parseFloat(document.getElementById('pf-qty').value)  || 0;
        var wgt  = parseFloat(document.getElementById('pf-wgt').value)  || 0;
        var rate = parseFloat(document.getElementById('pf-rate').value) || 0;
        var base = wgt > 0 ? wgt : qty;
        var amt  = Math.round(base * rate * 100) / 100;
        document.getElementById('pf-amount').value  = amt || '';
        document.getElementById('pf-netamt').value  = amt || '';
      }

      function resetPurForm() {
        ['pf-date','pf-billno','pf-item','pf-qty','pf-wgt','pf-rate','pf-amount','pf-netamt','pf-remarks'].forEach(function(id){
          var el=document.getElementById(id); if(el) el.value='';
        });
        var cat=document.getElementById('pf-category'); if(cat) cat.value='';
        var unit=document.getElementById('pf-unit'); if(unit) unit.value='KG';
        var vinp=document.getElementById('pf-vendor-input'); if(vinp) vinp.value='';
        var d = new Date(); var ds = d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        var dEl=document.getElementById('pf-date'); if(dEl) dEl.value=ds;
        var st=document.getElementById('pur-form-status'); if(st) st.style.display='none';
      }

      function submitPurEntry() {
        var dateEl  = document.getElementById('pf-date');
        var itemEl  = document.getElementById('pf-item');
        var qtyEl   = document.getElementById('pf-qty');
        var rateEl  = document.getElementById('pf-rate');
        var netEl   = document.getElementById('pf-netamt');
        var vinpEl  = document.getElementById('pf-vendor-input');

        if (!dateEl||!dateEl.value) { _purFormStatus('error','Purchase Date is required.'); return; }
        if (!vinpEl||!vinpEl.value.trim()) { _purFormStatus('error','Vendor name is required.'); return; }
        if (!itemEl||!itemEl.value.trim()) { _purFormStatus('error','Item name is required.'); return; }
        if (!netEl||!parseFloat(netEl.value)) { _purFormStatus('error','Net Amount is required.'); return; }

        var dateVal = dateEl.value; // yyyy-mm-dd
        var dp = dateVal.split('-'); var ddmm = dp[2]+'/'+dp[1]+'/'+dp[0];

        var data = {
          purchaseDate: ddmm,
          vendorName: vinpEl.value.trim(),
          itemName: itemEl.value.trim(),
          category: document.getElementById('pf-category').value,
          qty: parseFloat(qtyEl.value)||0,
          unit: document.getElementById('pf-unit').value,
          wgt: parseFloat(document.getElementById('pf-wgt').value)||0,
          rate: parseFloat(rateEl.value)||0,
          amount: parseFloat(document.getElementById('pf-amount').value)||0,
          netAmount: parseFloat(netEl.value)||0,
          billNo: document.getElementById('pf-billno').value.trim(),
          remarks: document.getElementById('pf-remarks').value.trim()
        };

        var btn = document.querySelector('#view-addPurchase .btn[onclick="submitPurEntry()"]');
        if(btn){ btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Saving...'; }

        google.script.run
          .withSuccessHandler(function(r) {
            if(btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Save Entry'; }
            if (r && r.success) {
              _purFormStatus('success','✓ Entry saved! '+r.msg);
              DB.purchases = []; // force reload
              resetPurForm();
            } else { _purFormStatus('error', r&&r.error?r.error:'Save failed.'); }
          })
          .withFailureHandler(function(e) {
            if(btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-save"></i> Save Entry'; }
            _purFormStatus('error', e.message||'Network error.');
          })
          .addPurchaseEntry(data, URL_NAME);
      }

      function _purFormStatus(type, msg) {
        var el = document.getElementById('pur-form-status');
        if (!el) return;
        var colors = { success:'green', error:'red', info:'blue', warn:'amber' };
        var icons  = { success:'check-circle', error:'exclamation-circle', info:'info-circle', warn:'exclamation-triangle' };
        el.className = 'info-box ' + (colors[type]||'red');
        el.innerHTML = '<i class="fas fa-'+(icons[type]||'exclamation-circle')+'"></i><span>'+msg+'</span>';
        el.style.display = 'flex';
      }

      // ── VENDOR MODAL ────────────────────────────────────────────────
      function openAddVendorModal() {
        ['av-name','av-phone','av-remarks'].forEach(function(id){ var el=document.getElementById(id); if(el) el.value=''; });
        var cat=document.getElementById('av-category'); if(cat) cat.value='';
        document.getElementById('addVendorModal').style.display='flex';
      }
      function closeAddVendorModal() { document.getElementById('addVendorModal').style.display='none'; }

      function saveNewVendor() {
        var name = (document.getElementById('av-name').value||'').trim();
        if (!name) { Swal.fire({icon:'warning',title:'Name Required',text:'Please enter vendor name.',background:'#0F172A',color:'#E2E8F0'}); return; }
        google.script.run
          .withSuccessHandler(function(r) {
            if (r && r.success) {
              DB.purchaseVendors.push({ vendorID:r.vendorID, vendorName:name, category:document.getElementById('av-category').value, phone:document.getElementById('av-phone').value, status:'Active', addedBy:URL_NAME });
              closeAddVendorModal();
              _buildPurVendorSS();
              if (_activeView === 'purchaseVendors') _doPVendRender();
              Swal.fire({icon:'success',title:'Vendor Added',text:name+' saved!',timer:1800,showConfirmButton:false,background:'#0F172A',color:'#E2E8F0'});
            } else { Swal.fire({icon:'error',title:'Error',text:r&&r.error?r.error:'Could not save vendor.',background:'#0F172A',color:'#E2E8F0'}); }
          })
          .withFailureHandler(function(e){ Swal.fire({icon:'error',title:'Network Error',text:e.message,background:'#0F172A',color:'#E2E8F0'}); })
          .createPurchaseVendor({ vendorName:name, category:document.getElementById('av-category').value||'', phone:document.getElementById('av-phone').value||'', remarks:document.getElementById('av-remarks').value||'' }, URL_NAME);
      }

      // ══════════════════════════════════════════════════════════════════
      //  PURCHASE PDF + CSV PARSER & UPLOAD
      // ══════════════════════════════════════════════════════════════════

      function handlePurFile(file) {
        if (!file) return;
        var ext = file.name.split('.').pop().toLowerCase();
        if (ext === 'pdf') { parsePurchasePDF(file); }
        else if (['csv','xlsx','xls'].indexOf(ext) >= 0) { parsePurchaseCSV(file, ext); }
        else { _purUploadStatus('error', 'Please select a .pdf, .csv, .xlsx or .xls file.'); }
      }

      // Category auto-tagger based on item name keywords
      function _autoCategory(itemName) {
        var n = (itemName||'').toLowerCase();
        if (/mushroom|shimji|enoki|eringi|shitake|oyster/.test(n)) return 'Mushroom';
        if (/mango|apple|grape|pear|plum|kiwi|berry|fruit|orange|lemon|lime|banana|pineapple|papaya|guava|pomelo|avacado|dragon|litchi|jamun|cherry|peach|apricot|melon|sarda|water.*mel/.test(n)) return 'Fruit';
        if (/basil|parsley|mint|rosemary|thyme|lemon grass|chive|dill|coriander|herb|sage|micro green|arugula|aragula|edible flower|shiso/.test(n)) return 'Herb';
        if (/paneer|dairy/.test(n)) return 'Dairy';
        if (/almond|cashew|raisin|walnut|pistachio|dates|dry fruit/.test(n)) return 'Dry Fruit';
        return 'Vegetable';
      }

      // ── Purchase PDF Parser ──────────────────────────────────────────
      // Layout: Fresko PURCHASE REGISTER PDF from Tally
      // Each page has: header rows, then vendor name line, then item rows, then DATE TOTAL line
      // Columns: Purchase Date | Item Name | Qty | Pack | Wgt | Rate | Amount | Net Amount
      async function parsePurchasePDF(file) {
        if (typeof pdfjsLib === 'undefined') {
          _purUploadStatus('error', 'PDF library loading. Please wait and retry.');
          return;
        }
        var dz = document.getElementById('pur-drop-zone');
        var prog = document.getElementById('pur-pdf-progress');
        var progBar = document.getElementById('pur-pdf-prog-bar');
        var progTxt = document.getElementById('pur-pdf-prog-txt');
        if (dz) { dz.style.opacity='.5'; dz.style.pointerEvents='none'; }
        if (prog) prog.style.display = 'block';

        try {
          var buf = await file.arrayBuffer();
          var pdf = await pdfjsLib.getDocument({data:buf}).promise;
          var total = pdf.numPages;
          var rows = [];
          var MONTHS = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};

          // Regex helpers
          var DATE_RE   = /^(\d{1,2})\/(\d{2})\/(\d{4})$/;    // dd/mm/yyyy
          var NUM_RE    = /^([\d,]+\.?\d*)$/;
          var SKIP_HDRS = /^(AGRONICO|PURCHASE REGISTER|Date|Item Name|Qty|Pack|Wgt|Rate|Amount|Net Amount|C-65|MAIL|MSME|Phone)/i;

          for (var p = 1; p <= total; p++) {
            if (progBar) progBar.style.width = Math.round((p/total)*100)+'%';
            if (progTxt) progTxt.textContent = 'Reading page '+p+' of '+total+'...';

            var page = await pdf.getPage(p);
            var tc = await page.getTextContent();
            var strs = tc.items.map(function(it){ return it.str; }).filter(function(s){ return s.trim()!==''; });

            // Parse page: identify vendor name lines, date lines, data lines, DATE TOTAL
            var currentVendor = '';
            var i = 0;
            while (i < strs.length) {
              var s = strs[i].trim();

              // Skip headers
              if (SKIP_HDRS.test(s) || /^Page \d+ of \d+$/.test(s)) { i++; continue; }

              // DATE TOTAL line
              if (/^DATE TOTAL/i.test(s)) {
                // Collect summary numbers from next few items
                var dNums = [];
                var j = i+1;
                while (j < Math.min(i+10, strs.length) && dNums.length < 4) {
                  var ns = strs[j].trim().replace(/,/g,'');
                  if (/^[\d]+\.?\d*$/.test(ns)) dNums.push(parseFloat(ns));
                  j++;
                }
                if (dNums.length >= 2) {
                  rows.push({ entryType:'DAYTOTAL', purchaseDate:'', vendorName:'DATE TOTAL',
                    itemName:'', category:'', qty:dNums[0]||0, unit:'', wgt:dNums[1]||0,
                    rate:0, amount:dNums[2]||0, netAmount:dNums[3]||dNums[2]||0, billNo:'', remarks:'' });
                }
                i = j; continue;
              }

              // GRAND TOTAL
              if (/^GRAND TOTAL/i.test(s)) {
                var gNums = [];
                var gj = i+1;
                while (gj < Math.min(i+10, strs.length) && gNums.length < 4) {
                  var gns = strs[gj].trim().replace(/,/g,'');
                  if (/^[\d]+\.?\d*$/.test(gns)) gNums.push(parseFloat(gns));
                  gj++;
                }
                if (gNums.length >= 2) {
                  rows.push({ entryType:'SUMMARY', purchaseDate:'', vendorName:'GRAND TOTAL',
                    itemName:'', category:'', qty:gNums[0]||0, unit:'', wgt:gNums[1]||0,
                    rate:0, amount:gNums[2]||0, netAmount:gNums[3]||gNums[2]||0, billNo:'', remarks:'' });
                }
                i = gj; continue;
              }

              // Date line — actual purchase row starts with date
              if (DATE_RE.test(s)) {
                // Pattern: Date | ItemName | Qty | Pack | Wgt | Rate | Amount | NetAmount
                // In PDF stream the numbers come scrambled. Collect next ~8 items.
                var pDate = s; // dd/mm/yyyy
                var pItems = [];
                var k = i+1;
                while (k < Math.min(i+12, strs.length)) {
                  var ps = strs[k].trim();
                  if (DATE_RE.test(ps) || /^DATE TOTAL/i.test(ps) || /^GRAND TOTAL/i.test(ps)) break;
                  pItems.push(ps);
                  k++;
                }

                // Extract numeric values
                var nums = [];
                var itemParts = [];
                pItems.forEach(function(pi) {
                  var pn = pi.replace(/,/g,'');
                  if (/^[\d]+\.?\d*$/.test(pn) && !DATE_RE.test(pi)) {
                    nums.push(parseFloat(pn));
                  } else if (!SKIP_HDRS.test(pi) && !/^(KG|Pkt|PCS|CRATE|BOX|DABBA|TRAY)$/.test(pi)) {
                    itemParts.push(pi);
                  }
                });

                // Find unit
                var unit = 'KG';
                pItems.forEach(function(pi){ if(/^(KG|Pkt|PCS|CRATE|BOX|DABBA|TRAY)$/.test(pi)) unit=pi; });

                var itemName = itemParts.filter(function(p){ return p && !DATE_RE.test(p); }).join(' ').trim();

                if (itemName && nums.length >= 2) {
                  // nums order from PDF: Rate | Amount | NetAmount (Wgt comes from Qty context)
                  // Typical: qty_col | wgt_col | rate | amount | netamt
                  var qty    = nums[0]||0;
                  var wgt    = nums[1]||0;
                  var rate   = nums[2]||0;
                  var amount = nums[3]||0;
                  var netAmt = nums[4]||amount;

                  rows.push({
                    entryType: 'ROW',
                    purchaseDate: pDate,
                    vendorName: currentVendor,
                    itemName: itemName,
                    category: _autoCategory(itemName),
                    qty: qty, unit: unit, wgt: wgt,
                    rate: rate, amount: amount, netAmount: netAmt,
                    billNo: '', remarks: ''
                  });
                }
                i = k; continue;
              }

              // Otherwise — treat as vendor name if it looks like one
              // Vendor names appear BEFORE date rows, are ALL CAPS, not numbers
              if (s.length > 3 && !NUM_RE.test(s) && s === s.toUpperCase() && !/^(To|Date|Page|PURCHASE)/.test(s)) {
                currentVendor = s;
              }
              i++;
            }
          }

          if (dz) { dz.style.opacity=''; dz.style.pointerEvents=''; }
          if (prog) prog.style.display = 'none';

          if (!rows.length) { _purUploadStatus('error', 'No data found in PDF. Please check the file.'); return; }
          _purParsed = rows;
          _buildPurPreview(rows, file.name, total);

        } catch(err) {
          if (dz) { dz.style.opacity=''; dz.style.pointerEvents=''; }
          if (prog) prog.style.display = 'none';
          _purUploadStatus('error', 'PDF Error: '+err.message);
        }
      }

      // ── Purchase CSV/Excel Parser ────────────────────────────────────
      async function parsePurchaseCSV(file, ext) {
        _purUploadStatus('info', '<i class="fas fa-spinner fa-spin"></i> Reading file...');
        try {
          var rows = [];
          if (ext === 'csv') {
            var text = await file.text();
            var lines = text.split('\n').map(function(l){ return l.trim(); }).filter(Boolean);
            if (!lines.length) { _purUploadStatus('error', 'Empty file.'); return; }
            var headers = lines[0].split(',').map(function(h){ return h.trim().toUpperCase().replace(/['"]/g,''); });
            for (var li = 1; li < lines.length; li++) {
              var cols = lines[li].split(',').map(function(c){ return c.trim().replace(/^"|"$/g,''); });
              var row = {};
              headers.forEach(function(h,idx){ row[h]=cols[idx]||''; });
              if (!row['ITEM NAME'] && !row['ITEM']) continue;
              rows.push({
                entryType:'ROW',
                purchaseDate: row['PURCHASE DATE']||row['DATE']||'',
                vendorName: row['VENDOR NAME']||row['VENDOR']||row['SUPPLIER']||'',
                itemName: row['ITEM NAME']||row['ITEM']||'',
                category: row['CATEGORY']||_autoCategory(row['ITEM NAME']||row['ITEM']||''),
                qty: parseFloat(row['QTY']||row['QUANTITY']||0)||0,
                unit: row['UNIT']||row['PACK']||'KG',
                wgt: parseFloat(row['WGT']||row['WEIGHT']||0)||0,
                rate: parseFloat(row['RATE']||0)||0,
                amount: parseFloat(row['AMOUNT']||0)||0,
                netAmount: parseFloat(row['NET AMOUNT']||row['NET AMT']||row['AMOUNT']||0)||0,
                billNo: row['BILL NO']||row['BILL NUMBER']||'',
                remarks: row['REMARKS']||''
              });
            }
          } else {
            // xlsx/xls — use SheetJS if available
            if (typeof XLSX === 'undefined') { _purUploadStatus('error', 'Excel parser not loaded.'); return; }
            var buf = await file.arrayBuffer();
            var wb = XLSX.read(buf, {type:'array'});
            var ws = wb.Sheets[wb.SheetNames[0]];
            var data = XLSX.utils.sheet_to_json(ws, {defval:''});
            data.forEach(function(row) {
              var k = Object.keys(row).reduce(function(o,k){ o[k.trim().toUpperCase()]=row[k]; return o; },{});
              if (!k['ITEM NAME'] && !k['ITEM']) return;
              rows.push({
                entryType:'ROW',
                purchaseDate: (k['PURCHASE DATE']||k['DATE']||'').toString(),
                vendorName: (k['VENDOR NAME']||k['VENDOR']||k['SUPPLIER']||'').toString(),
                itemName: (k['ITEM NAME']||k['ITEM']||'').toString(),
                category: (k['CATEGORY']||_autoCategory(k['ITEM NAME']||k['ITEM']||'')).toString(),
                qty: parseFloat(k['QTY']||k['QUANTITY']||0)||0,
                unit: (k['UNIT']||k['PACK']||'KG').toString(),
                wgt: parseFloat(k['WGT']||k['WEIGHT']||0)||0,
                rate: parseFloat(k['RATE']||0)||0,
                amount: parseFloat(k['AMOUNT']||0)||0,
                netAmount: parseFloat(k['NET AMOUNT']||k['NET AMT']||k['AMOUNT']||0)||0,
                billNo: (k['BILL NO']||k['BILL NUMBER']||'').toString(),
                remarks: (k['REMARKS']||'').toString()
              });
            });
          }

          if (!rows.length) { _purUploadStatus('error', 'No rows found. Check column headers: PURCHASE DATE, VENDOR NAME, ITEM NAME, QTY, UNIT, WGT, RATE, AMOUNT, NET AMOUNT'); return; }
          _purParsed = rows;
          _buildPurPreview(rows, file.name);
        } catch(err) { _purUploadStatus('error', 'File read error: '+err.message); }
      }

      function _buildPurPreview(rows, fname, totalPages) {
        var wrap  = document.getElementById('pur-preview-wrap');
        var tbody = document.getElementById('pur-preview-tbody');
        var title = document.getElementById('pur-preview-title');
        if (!wrap||!tbody) return;

        var dataRows    = rows.filter(function(r){ return r.entryType==='ROW'; });
        var totalRows   = rows.filter(function(r){ return r.entryType==='DAYTOTAL'||r.entryType==='SUMMARY'; });
        var vendors     = new Set(dataRows.map(function(r){ return r.vendorName; })).size;
        var totalNetAmt = dataRows.reduce(function(s,r){ return s+(r.netAmount||0); }, 0);

        if (title) title.textContent = fname+' — '+rows.length+' rows ('+dataRows.length+' entries, '+totalRows.length+' totals) | '+vendors+' vendors | ₹'+_fmt(totalNetAmt)+' net';

        _purUploadStatus('success', '✓ '+dataRows.length+' purchase entries detected across '+vendors+' vendors. Review below and click Upload.');

        // Preview: first 200 rows
        tbody.innerHTML = rows.slice(0,200).map(function(r) {
          var isTot = r.entryType!=='ROW';
          var cls = isTot ? 'style="background:#F0FDF4;font-weight:700;font-size:11px"' : '';
          return '<tr '+cls+'>' +
            '<td>'+(isTot?'<span class="badge green">'+r.entryType+'</span>':'ROW')+'</td>'+
            '<td>'+esc(r.purchaseDate)+'</td>'+
            '<td>'+esc(r.vendorName)+'</td>'+
            '<td>'+esc(r.itemName)+'</td>'+
            '<td>'+esc(r.category)+'</td>'+
            '<td style="text-align:right">'+_fmt(r.qty)+'</td>'+
            '<td>'+esc(r.unit)+'</td>'+
            '<td style="text-align:right">'+_fmt(r.wgt)+'</td>'+
            '<td style="text-align:right">'+_fmt(r.rate)+'</td>'+
            '<td style="text-align:right">'+_fmt(r.amount)+'</td>'+
            '<td style="text-align:right;font-weight:600">₹'+_fmt(r.netAmount)+'</td>'+
            '<td>'+esc(r.billNo||'')+'</td></tr>';
        }).join('');
        if (rows.length > 200) tbody.innerHTML += '<tr><td colspan="12" style="text-align:center;padding:10px;color:var(--muted)">...and '+(rows.length-200)+' more rows (all will be uploaded)</td></tr>';
        wrap.style.display = 'block';
      }

      function _purUploadStatus(type, msg) {
        var el = document.getElementById('pur-upload-status');
        if (!el) return;
        var colors = { success:'green', error:'red', info:'blue', warn:'amber' };
        var icons  = { success:'check-circle', error:'exclamation-circle', info:'info-circle', warn:'exclamation-triangle' };
        el.className = 'info-box ' + (colors[type]||'red');
        el.innerHTML = '<i class="fas fa-'+(icons[type]||'exclamation-circle')+'"></i><span>'+msg+'</span>';
        el.style.display = 'flex';
      }

      function clearPurUpload() {
        _purParsed = [];
        var inp = document.getElementById('pur-file-inp'); if(inp) inp.value='';
        var wrap = document.getElementById('pur-preview-wrap'); if(wrap) wrap.style.display='none';
        var st = document.getElementById('pur-upload-status'); if(st) st.style.display='none';
        var dz = document.getElementById('pur-drop-zone'); if(dz){ dz.style.opacity=''; dz.style.pointerEvents=''; }
      }

      function uploadPurchase() {
        if (!_purParsed.length) { _purUploadStatus('warn','No data to upload.'); return; }
        var total  = _purParsed.length;
        var chunks = Math.ceil(total/10);
        var btn = document.getElementById('pur-upload-btn');
        if(btn){ btn.disabled=true; btn.innerHTML='<i class="fas fa-spinner fa-spin"></i> Uploading...'; }

        var statusEl = document.getElementById('pur-upload-status');
        statusEl.className='info-box blue'; statusEl.style.display='flex';
        statusEl.innerHTML='<div style="width:100%"><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px"><span style="font-weight:700;font-size:13px"><i class="fas fa-cloud-upload-alt" style="margin-right:6px"></i>Uploading Purchase Data</span><span id="pur-up-counter" style="font-size:13px;font-weight:800;color:#1967D2">0 / '+total+'</span></div><div style="background:#BFDBFE;border-radius:6px;height:10px;overflow:hidden;margin-bottom:6px"><div id="pur-up-bar" style="height:100%;width:0%;background:linear-gradient(90deg,#4285F4,#1967D2);border-radius:6px;transition:width .4s ease"></div></div><div style="display:flex;justify-content:space-between;font-size:11px;color:#1967D2"><span id="pur-up-status">Starting...</span><span id="pur-up-pct">0%</span></div></div>';

        // Chunked upload using same pattern as sales
        var rows   = _purParsed;
        var chunkSize = 10;
        var chunks_arr = [];
        for(var ci=0; ci<rows.length; ci+=chunkSize) chunks_arr.push(rows.slice(ci,ci+chunkSize));
        var merged = { success:true, rowsAdded:0, vendorsAdded:0 };
        var idx = 0;

        function nextChunk() {
          if (idx >= chunks_arr.length) {
            if(btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-cloud-upload-alt"></i> Upload to PurchaseRegister'; }
            var bar=document.getElementById('pur-up-bar'); if(bar) bar.style.width='100%';
            setTimeout(function(){
              _purUploadStatus('success', '✓ '+merged.rowsAdded+' rows uploaded'+
                (merged.vendorsAdded?' ('+merged.vendorsAdded+' new vendors created)':'')+'.');
              clearPurUpload(); DB.purchases=[]; DB.purchaseVendors=[];
            }, 400);
            return;
          }
          var pct = Math.round((idx/chunks_arr.length)*100);
          var bar=document.getElementById('pur-up-bar'); if(bar) bar.style.width=pct+'%';
          var ctr=document.getElementById('pur-up-counter'); if(ctr) ctr.textContent=merged.rowsAdded+' / '+total;
          var sts=document.getElementById('pur-up-status'); if(sts) sts.textContent='Batch '+(idx+1)+' of '+chunks_arr.length+'...';
          var pctEl=document.getElementById('pur-up-pct'); if(pctEl) pctEl.textContent=pct+'%';

          google.script.run
            .withSuccessHandler(function(r) {
              if(r&&r.success){ merged.rowsAdded+=(r.rowsAdded||0); merged.vendorsAdded+=(r.vendorsAdded||0); }
              idx++; nextChunk();
            })
            .withFailureHandler(function(e) {
              if(btn){ btn.disabled=false; btn.innerHTML='<i class="fas fa-cloud-upload-alt"></i> Upload to PurchaseRegister'; }
              _purUploadStatus('error','Upload failed at batch '+(idx+1)+': '+(e.message||'Network error'));
            })
            .bulkUploadPurchase(chunks_arr[idx], URL_NAME);
        }
        nextChunk();
      }
