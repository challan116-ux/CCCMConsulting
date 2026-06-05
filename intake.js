/* ============================================================================
   CCCM Consulting — "Scout" project scoping assistant
   ----------------------------------------------------------------------------
   A self-contained, adaptive intake bot. It interviews the prospect with a
   branching question graph, decides when it has enough coverage, then drafts a
   rough LOE, FSD outline, industry build + maintenance cost range, and a
   recommended tooling plan — and submits the brief to the (not-yet-built)
   intake mailbox.

   SWAP POINTS for going live:
     • askBrain()      -> replace the deterministic next-question logic with a
                          call to an OpenAI / Vercel AI SDK endpoint.
     • buildEstimate() -> replace heuristics with an LLM-generated LOE/FSD.
     • submitIntake()  -> point /api/intake at the real mailbox service.
   ========================================================================== */
(function () {
  'use strict';

  /* ----------------------------------------------------------------------- */
  /* State                                                                   */
  /* ----------------------------------------------------------------------- */
  var state = { answers: {}, flags: {}, askedIds: [] };
  var els = {};
  var started = false;

  function kindLabel() {
    var k = state.answers.projectKind;
    if (k === 'A web app') return 'web app';
    if (k === 'A website / marketing site') return 'website';
    if (k === 'Both app + site') return 'app + site';
    return 'product';
  }

  /* ----------------------------------------------------------------------- */
  /* Question graph — order matters; `when` gates applicability              */
  /* ----------------------------------------------------------------------- */
  var QUESTIONS = [
    { id: 'name', dim: 'contact', type: 'text', required: true, placeholder: 'Your name',
      q: function () { return "Hi, I'm Scout — CCCM's project scoping assistant. I'll ask a few quick questions, then draft a rough scope, cost range and tooling plan for your project. No sales call, I promise.\n\nFirst — what's your name?"; } },

    { id: 'email', dim: 'contact', type: 'email', required: true, placeholder: 'you@company.com',
      q: function () { return 'Nice to meet you, ' + (state.answers.name || 'there') + '. What’s the best email to send your project brief to?'; } },

    { id: 'company', dim: 'company', type: 'text', required: true, placeholder: 'Company name (or “personal”)',
      q: function () { return 'Which company is this for?'; } },

    { id: 'industry', dim: 'company', type: 'single', required: true,
      q: function () { return 'What industry are you in?'; },
      options: ['SaaS / Software', 'E-commerce / Retail', 'Healthcare', 'Finance / Fintech', 'Professional services', 'Education', 'Media / Content', 'Logistics / Supply chain', 'Other'] },

    { id: 'projectKind', dim: 'scope', type: 'single', required: true,
      q: function () { return 'Got it. At a high level, what do you need built?'; },
      options: ['A web app', 'A website / marketing site', 'Both app + site', 'Not sure yet'] },

    { id: 'goal', dim: 'scope', type: 'textarea', required: true, placeholder: 'e.g. Let customers book and pay for appointments, and give our team a dashboard to manage them.',
      q: function () { return 'In a sentence or two — what should this ' + kindLabel() + ' do for your business?'; } },

    { id: 'audience', dim: 'users', type: 'single', required: true,
      q: function () { return 'Who will mainly use it?'; },
      options: ['Public / customers', 'Our internal team', 'Both', 'Partners / other businesses'] },

    { id: 'features', dim: 'features', type: 'multi', required: true, min: 1,
      q: function () { return 'Which of these will it need? Pick all that apply — you can add your own too.'; },
      options: ['User accounts & login', 'Admin dashboard', 'Online store / payments', 'Booking / scheduling',
                'Content / blog (CMS)', 'Search', 'Messaging / chat', 'File uploads & documents',
                'Reporting & analytics', 'AI features', 'Notifications / email', 'Maps / location'] },

    { id: 'ai_usecases', dim: 'ai', type: 'multi',
      when: function () { return has('features', 'AI features'); },
      q: function () { return 'Nice — what should the AI do? (this is our home turf)'; },
      options: ['Chatbot / assistant', 'Document extraction', 'Content generation', 'Recommendations', 'Semantic search', 'Data analysis', 'Automation / agents'] },

    { id: 'commerce_detail', dim: 'commerce', type: 'single',
      when: function () { return has('features', 'Online store / payments'); },
      q: function () { return 'How will payments work?'; },
      options: ['One-time purchases', 'Subscriptions / recurring', 'Both', 'Marketplace (multiple sellers)'] },

    { id: 'auth_detail', dim: 'auth', type: 'single',
      when: function () { return has('features', 'User accounts & login'); },
      q: function () { return 'What kind of sign-in do you need?'; },
      options: ['Simple email + password', 'Social login (Google, etc.)', 'Enterprise SSO', 'Roles & permissions (RBAC)', 'High security / 2FA'] },

    { id: 'integrations', dim: 'integrations', type: 'multi',
      q: function () { return 'Any existing tools it should connect to?'; },
      options: ['Stripe / payments', 'Email (Resend / SendGrid)', 'Google (Ads / Analytics / Workspace)', 'CRM (HubSpot / Salesforce)', 'Accounting (QuickBooks / Xero)', 'Calendar', 'Slack / Teams', 'SMS', 'ERP / EDI', 'None yet'] },

    { id: 'data_sensitivity', dim: 'compliance', type: 'single', required: true,
      q: function () { return 'What kind of data will it handle?'; },
      options: ['Standard business data', 'Personal data (GDPR)', 'Health data (HIPAA-like)', 'Financial / card data (PCI)', 'Not sure'] },

    { id: 'design_state', dim: 'design', type: 'single', required: true,
      q: function () { return 'Where are you with branding & design?'; },
      options: ['We have a brand + designs', 'We have a brand, need design', 'Starting from scratch', 'Just make it look great'] },

    { id: 'scale', dim: 'scale', type: 'single', required: true,
      q: function () { return 'What scale are you planning for at launch?'; },
      options: ['MVP / first version', 'Hundreds of users', 'Thousands of users', 'Large / high traffic'] },

    { id: 'timeline', dim: 'timeline', type: 'single', required: true,
      q: function () { return 'And the timeline you’re hoping for?'; },
      options: ['ASAP (under a month)', '1–3 months', '3–6 months', 'Flexible'] },

    { id: 'budget', dim: 'budget', type: 'single', required: true,
      q: function () { return 'Roughly what budget range are you working with? (helps us tailor scope)'; },
      options: ['Under $10k', '$10k – $30k', '$30k – $75k', '$75k – $150k', '$150k+', 'Not sure — guide me'] },

    { id: 'support', dim: 'support', type: 'single', required: true,
      q: function () { return 'After launch, will you want us around?'; },
      options: ['Yes — ongoing support & iteration', 'Just build & hand over', 'Not sure yet'] },

    { id: 'notes', dim: 'notes', type: 'textarea', placeholder: 'Constraints, examples you love, must-haves… (optional)',
      q: function () { return 'Last one — anything else we should know? Constraints, products you admire, hard requirements? (optional, you can skip)'; } }
  ];

  function has(answerId, value) {
    var a = state.answers[answerId];
    return Array.isArray(a) && a.indexOf(value) !== -1;
  }
  function applicable(qq) { return typeof qq.when !== 'function' || qq.when(); }
  function answered(qq) { return Object.prototype.hasOwnProperty.call(state.answers, qq.id); }

  /* The "brain": decide the next question, or null when we have enough. */
  function askBrain() {
    for (var i = 0; i < QUESTIONS.length; i++) {
      if (applicable(QUESTIONS[i]) && !answered(QUESTIONS[i])) return QUESTIONS[i];
    }
    return null;
  }

  function coverage() {
    var total = 0, done = 0;
    QUESTIONS.forEach(function (qq) {
      if (!applicable(qq)) return;
      total++;
      if (answered(qq)) done++;
    });
    return total ? Math.round((done / total) * 100) : 0;
  }

  /* ----------------------------------------------------------------------- */
  /* Estimate engine — LOE / FSD / cost / tooling                            */
  /* ----------------------------------------------------------------------- */
  var FEATURE_HOURS = {
    'User accounts & login': 56,
    'Admin dashboard': 80,
    'Online store / payments': 90,
    'Booking / scheduling': 60,
    'Content / blog (CMS)': 50,
    'Search': 34,
    'Messaging / chat': 70,
    'File uploads & documents': 46,
    'Reporting & analytics': 60,
    'AI features': 80,
    'Notifications / email': 30,
    'Maps / location': 34
  };

  function round(n, step) { step = step || 1; return Math.round(n / step) * step; }
  function money(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

  function buildEstimate() {
    var a = state.answers;
    var feats = a.features || [];
    var foundation = 50; // setup, CI, infra, base UI system
    var eng = foundation;

    feats.forEach(function (f) { eng += (FEATURE_HOURS[f] || 30); });

    // AI depth
    if (has('features', 'AI features')) {
      var uc = (a.ai_usecases || []).length;
      eng += Math.min(uc, 5) * 28;
      if (has('ai_usecases', 'Document extraction')) eng += 30;
      if (has('ai_usecases', 'Automation / agents')) eng += 30;
    }
    // Commerce depth
    if (has('features', 'Online store / payments')) {
      if (a.commerce_detail === 'Subscriptions / recurring') eng += 40;
      else if (a.commerce_detail === 'Both') eng += 55;
      else if (a.commerce_detail === 'Marketplace (multiple sellers)') eng += 120;
    }
    // Auth depth
    var authExtra = { 'Social login (Google, etc.)': 16, 'Enterprise SSO': 50, 'Roles & permissions (RBAC)': 40, 'High security / 2FA': 24 };
    if (a.auth_detail && authExtra[a.auth_detail]) eng += authExtra[a.auth_detail];

    // Integrations
    var integ = (a.integrations || []).filter(function (x) { return x !== 'None yet'; });
    eng += integ.length * 24;

    // Site pages if a website is in scope
    if (a.projectKind === 'A website / marketing site' || a.projectKind === 'Both app + site') eng += 45;

    // Compliance
    var compExtra = { 'Personal data (GDPR)': 40, 'Health data (HIPAA-like)': 90, 'Financial / card data (PCI)': 70 };
    if (compExtra[a.data_sensitivity]) eng += compExtra[a.data_sensitivity];

    // Design extra (folded into design phase below)
    var designExtra = { 'Starting from scratch': 60, 'We have a brand, need design': 40, 'Just make it look great': 30, 'We have a brand + designs': 0 }[a.design_state] || 30;

    // Scale multiplier
    var scaleMult = { 'MVP / first version': 1.0, 'Hundreds of users': 1.06, 'Thousands of users': 1.2, 'Large / high traffic': 1.45 }[a.scale] || 1.05;
    eng = eng * scaleMult;

    // Phases
    var discovery = Math.max(24, eng * 0.10);
    var design = Math.max(30, eng * 0.15 + designExtra);
    var qa = eng * 0.15;
    var launch = eng * 0.06;
    var pm = (discovery + design + eng + qa + launch) * 0.12;

    var phases = [
      { name: 'Discovery & FSD', hours: round(discovery) },
      { name: 'UX / UI design', hours: round(design) },
      { name: 'Engineering & build', hours: round(eng) },
      { name: 'QA & hardening', hours: round(qa) },
      { name: 'Launch & handover', hours: round(launch) },
      { name: 'Project management', hours: round(pm) }
    ];
    var totalHours = phases.reduce(function (s, p) { return s + p.hours; }, 0);

    // Cost — blended industry rate band
    var rateLow = 85, rateLikely = 120, rateHigh = 160;
    var costLow = round(totalHours * rateLow, 500);
    var costLikely = round(totalHours * rateLikely, 500);
    var costHigh = round(totalHours * 1.15 * rateHigh, 1000);

    // Timeline — small pod ~70 productive hrs/week
    var weeks = Math.max(3, Math.round(totalHours / 70));

    // Maintenance / support
    var wantsSupport = a.support === 'Yes — ongoing support & iteration';
    var maintMonthlyLow = round((costLikely * 0.12) / 12, 100);
    var maintMonthlyHigh = round((costLikely * 0.20) / 12, 100);

    return {
      phases: phases, totalHours: totalHours,
      costLow: costLow, costLikely: costLikely, costHigh: costHigh,
      rateBand: rateLow + '–' + rateHigh,
      weeks: weeks,
      wantsSupport: wantsSupport,
      maintMonthlyLow: maintMonthlyLow, maintMonthlyHigh: maintMonthlyHigh,
      tools: recommendTools(),
      fsd: buildFSD()
    };
  }

  function recommendTools() {
    var groups = [];
    function g(name, items) { if (items.length) groups.push({ name: name, items: items }); }

    g('Core', ['Next.js (App Router)', 'TypeScript', 'Tailwind CSS', 'Vercel hosting']);

    var ai = [];
    if (has('features', 'AI features')) {
      ai.push('OpenAI', 'Vercel AI SDK', 'Zod (validated output)');
      if (has('ai_usecases', 'Semantic search') || has('ai_usecases', 'Document extraction')) ai.push('Vector search (pgvector)');
      if (has('ai_usecases', 'Document extraction')) ai.push('pdf-parse');
    }
    g('AI', ai);

    var data = ['PostgreSQL', 'Prisma ORM'];
    if (has('features', 'Reporting & analytics')) data.push('Tremor / Recharts');
    if (has('features', 'Messaging / chat') || has('ai_usecases', 'Automation / agents')) data.push('BullMQ (queues)');
    g('Data & backend', data);

    var auth = [];
    if (has('features', 'User accounts & login')) {
      auth.push('Auth.js');
      if (a('auth_detail') === 'High security / 2FA') auth.push('otplib (2FA)');
      if (a('auth_detail') === 'Roles & permissions (RBAC)') auth.push('Row-level security');
    }
    if (has('features', 'Online store / payments')) auth.push('Stripe');
    g('Auth & commerce', auth);

    var integ = [];
    var sel = state.answers.integrations || [];
    if (sel.indexOf('Email (Resend / SendGrid)') !== -1 || has('features', 'Notifications / email')) integ.push('Resend');
    if (sel.indexOf('Google (Ads / Analytics / Workspace)') !== -1) integ.push('Google APIs');
    if (sel.indexOf('ERP / EDI') !== -1) integ.push('SFTP / EDI (X12)');
    if (sel.indexOf('Slack / Teams') !== -1) integ.push('Slack API');
    if (sel.indexOf('SMS') !== -1) integ.push('Twilio');
    g('Integrations', integ);

    g('Quality & ops', ['Playwright + Vitest', 'Sentry', 'PostHog', 'OpenTelemetry']);
    return groups;
  }
  function a(id) { return state.answers[id]; }

  function buildFSD() {
    var ans = state.answers;
    var sections = [];
    sections.push({ h: 'Overview & objectives', body: (ans.goal || 'TBD') + '\n\nFor ' + (ans.company || 'the client') + ' (' + (ans.industry || 'industry TBD') + '), delivered as ' + kindLabel() + '.' });

    var roles = ans.audience === 'Our internal team' ? 'Internal staff users; admin'
      : ans.audience === 'Partners / other businesses' ? 'Partner/B2B users; admin; CCCM ops'
      : ans.audience === 'Both' ? 'Customers; internal staff; admin'
      : 'Customers/visitors; admin';
    if (has('features', 'User accounts & login') && ans.auth_detail) roles += ' — sign-in: ' + ans.auth_detail.toLowerCase();
    sections.push({ h: 'Users & roles', body: roles });

    var mods = (ans.features || []).slice();
    if (has('features', 'Online store / payments') && ans.commerce_detail) mods.push('Payments: ' + ans.commerce_detail.toLowerCase());
    if (has('features', 'AI features') && (ans.ai_usecases || []).length) mods.push('AI: ' + ans.ai_usecases.join(', ').toLowerCase());
    sections.push({ h: 'Functional modules', body: mods.length ? '• ' + mods.join('\n• ') : 'Core pages and flows.' });

    var integ = (ans.integrations || []).filter(function (x) { return x !== 'None yet'; });
    sections.push({ h: 'Integrations', body: integ.length ? '• ' + integ.join('\n• ') : 'None identified yet.' });

    sections.push({ h: 'Data & compliance', body: 'Data class: ' + (ans.data_sensitivity || 'TBD') + '. Encryption in transit & at rest, audit logging, and least-privilege access as standard.' });
    sections.push({ h: 'Non-functional', body: 'Responsive & accessible (WCAG AA), performance budgets, observability (Sentry/OTel), automated tests, and CI release gates. Target scale: ' + (ans.scale || 'TBD') + '.' });
    sections.push({ h: 'Assumptions & out of scope', body: 'Estimate is pre-discovery and assumes a single web platform, English-only at launch, and client-provided content unless noted. Native mobile apps, complex data migration, and third-party licensing are excluded pending discovery.' });
    return sections;
  }

  /* ----------------------------------------------------------------------- */
  /* Rendering                                                               */
  /* ----------------------------------------------------------------------- */
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function scrollDown() { els.messages.scrollTop = els.messages.scrollHeight; }

  function botAvatar() { return el('span', 'msg-avatar text-ink', 'Sc'); }

  function addBot(text, opts) {
    opts = opts || {};
    var row = el('div', 'msg msg-bot');
    var av = botAvatar(); av.style.background = 'linear-gradient(135deg,#FBBF24,#38BDF8)';
    var b = el('div', 'bubble', text.split('\n').map(escapeHtml).join('<br>'));
    row.appendChild(av); row.appendChild(b);
    els.messages.appendChild(row); scrollDown();
    return row;
  }

  function addUser(text) {
    var row = el('div', 'msg msg-user');
    var av = el('span', 'msg-avatar bg-panel text-slate-300 ring-1 ring-line',
      escapeHtml((state.answers.name || 'You').trim().charAt(0).toUpperCase() || 'Y'));
    var b = el('div', 'bubble', escapeHtml(text));
    row.appendChild(av); row.appendChild(b);
    els.messages.appendChild(row); scrollDown();
  }

  function typing(cb, delay) {
    var row = el('div', 'msg msg-bot');
    var av = botAvatar(); av.style.background = 'linear-gradient(135deg,#FBBF24,#38BDF8)';
    var b = el('div', 'bubble typing', '<span></span><span></span><span></span>');
    row.appendChild(av); row.appendChild(b);
    els.messages.appendChild(row); scrollDown();
    setTimeout(function () { row.remove(); cb(); }, delay || 600);
  }

  function clearDock() { els.dock.innerHTML = ''; }

  function setProgress(pct, label) {
    els.bar.style.width = pct + '%';
    els.pct.textContent = pct + '%';
    if (label) els.stage.textContent = label;
  }

  /* Render the active question's input affordance into the dock */
  function renderInput(qq) {
    clearDock();

    if (qq.type === 'single') {
      var wrap = el('div', 'flex flex-wrap gap-2');
      qq.options.forEach(function (opt) {
        var btn = el('button', 'chip-btn cursor-pointer rounded-xl border border-line bg-panel/60 px-3.5 py-2 text-sm text-slate-300');
        btn.type = 'button'; btn.textContent = opt;
        btn.addEventListener('click', function () { submitAnswer(qq, opt); });
        wrap.appendChild(btn);
      });
      els.dock.appendChild(wrap);
      return;
    }

    if (qq.type === 'multi') {
      var picked = [];
      var grid = el('div', 'flex flex-wrap gap-2 mb-3');
      qq.options.forEach(function (opt) {
        var btn = el('button', 'chip-btn cursor-pointer rounded-xl border border-line bg-panel/60 px-3.5 py-2 text-sm text-slate-300');
        btn.type = 'button'; btn.textContent = opt; btn.setAttribute('aria-pressed', 'false');
        btn.addEventListener('click', function () {
          var i = picked.indexOf(opt);
          if (i === -1) { picked.push(opt); btn.setAttribute('aria-pressed', 'true'); }
          else { picked.splice(i, 1); btn.setAttribute('aria-pressed', 'false'); }
          cont.disabled = picked.length < (qq.min || 0);
          cont.classList.toggle('opacity-40', cont.disabled);
        });
        grid.appendChild(btn);
      });
      // custom add
      var addRow = el('div', 'flex gap-2 mb-3');
      var addInput = el('input', 'flex-1 rounded-xl border border-line bg-panel/60 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-gold/50');
      addInput.placeholder = 'Add your own…';
      var addBtn = el('button', 'rounded-xl pill px-3 text-sm text-slate-200 cursor-pointer', '+');
      addBtn.type = 'button';
      addBtn.addEventListener('click', function () {
        var v = addInput.value.trim(); if (!v) return;
        var b = el('button', 'chip-btn cursor-pointer rounded-xl border border-gold/50 bg-gold/16 px-3.5 py-2 text-sm text-white');
        b.type = 'button'; b.textContent = v; b.setAttribute('aria-pressed', 'true');
        picked.push(v);
        b.addEventListener('click', function () { var i = picked.indexOf(v); if (i > -1) picked.splice(i, 1); b.remove(); });
        grid.appendChild(b); addInput.value = '';
        cont.disabled = picked.length < (qq.min || 0); cont.classList.toggle('opacity-40', cont.disabled);
      });
      addRow.appendChild(addInput); addRow.appendChild(addBtn);

      var cont = el('button', 'w-full rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-ink cursor-pointer', 'Continue');
      cont.type = 'button';
      cont.disabled = (qq.min || 0) > 0; cont.classList.toggle('opacity-40', cont.disabled);
      cont.addEventListener('click', function () { if (picked.length >= (qq.min || 0)) submitAnswer(qq, picked.slice()); });

      els.dock.appendChild(grid); els.dock.appendChild(addRow); els.dock.appendChild(cont);
      return;
    }

    // text / email / textarea
    var form = el('form', 'flex items-end gap-2');
    var input;
    if (qq.type === 'textarea') {
      input = el('textarea', 'flex-1 resize-none rounded-xl border border-line bg-panel/60 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-gold/50');
      input.rows = 2;
    } else {
      input = el('input', 'flex-1 rounded-xl border border-line bg-panel/60 px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-gold/50');
      input.type = qq.type === 'email' ? 'email' : 'text';
    }
    input.placeholder = qq.placeholder || 'Type here…';
    var send = el('button', 'shrink-0 grid place-items-center h-10 w-10 rounded-xl bg-gold text-ink cursor-pointer',
      '<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M13 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>');
    send.type = 'submit';
    form.appendChild(input); form.appendChild(send);

    if (!qq.required) {
      var skip = el('button', 'mt-2 text-xs text-slate-500 hover:text-slate-300 cursor-pointer', 'Skip this');
      skip.type = 'button';
      skip.addEventListener('click', function () { submitAnswer(qq, '', true); });
      var holder = el('div'); holder.appendChild(form); holder.appendChild(skip);
      els.dock.appendChild(holder);
    } else {
      els.dock.appendChild(form);
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim();
      if (qq.required && !v) { input.focus(); return; }
      if (qq.type === 'email' && v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
        input.classList.add('border-red-400'); return;
      }
      submitAnswer(qq, v);
    });
    setTimeout(function () { input.focus(); }, 50);
  }

  function prettyAnswer(qq, value, skipped) {
    if (skipped) return '(skipped)';
    if (Array.isArray(value)) return value.join(', ');
    return value;
  }

  function submitAnswer(qq, value, skipped) {
    if (!skipped || value) state.answers[qq.id] = value;
    else state.answers[qq.id] = '';
    state.askedIds.push(qq.id);
    addUser(prettyAnswer(qq, value, skipped));
    clearDock();
    setProgress(coverage(), 'Scoping — ' + Object.keys(state.answers).length + ' answers');
    advance();
  }

  function advance() {
    var next = askBrain();
    if (!next) { finalize(); return; }
    var label = next.required === false ? 'Almost done' : 'Scoping your project';
    typing(function () {
      addBot(next.q());
      setProgress(coverage(), label);
      renderInput(next);
    }, 520);
  }

  /* ----------------------------------------------------------------------- */
  /* Finalize -> generate + render brief + submit                           */
  /* ----------------------------------------------------------------------- */
  function finalize() {
    setProgress(100, 'Generating your brief');
    clearDock();
    typing(function () {
      addBot('Perfect — I’ve got enough to work with. Give me a moment while I draft your level of effort, functional spec, cost range and tooling plan…');
      setTimeout(function () {
        var est = buildEstimate();
        state.estimate = est;
        renderBrief(est);
      }, 1100);
    }, 500);
  }

  function briefCard(est) {
    var a = state.answers;
    var c = el('div', 'brief-section p-4 sm:p-5 mt-1');

    function row(label, val) {
      return '<div class="flex items-center justify-between gap-3 py-1.5 border-b border-line last:border-0">' +
             '<span class="text-slate-400 text-sm">' + label + '</span>' +
             '<span class="text-white text-sm font-medium text-right">' + val + '</span></div>';
    }

    // Header
    var html = '<div class="flex items-center gap-2 mb-3">' +
      '<span class="grid place-items-center h-7 w-7 rounded-lg bg-gold/15 text-gold text-xs font-bold">✓</span>' +
      '<h3 class="font-display font-semibold text-white">Your draft project brief</h3></div>' +
      '<p class="text-xs text-slate-500 mb-4">Rough, AI-generated and pre-discovery — a starting point, not a fixed quote.</p>';

    // Cost headline
    html += '<div class="rounded-xl bg-gradient-to-br from-gold/12 to-cyan/8 ring-1 ring-gold/20 p-4 mb-4">' +
      '<div class="text-xs uppercase tracking-wider text-slate-400">Estimated build cost</div>' +
      '<div class="font-display text-2xl font-bold text-white mt-1">' + money(est.costLow) + ' – ' + money(est.costHigh) + '</div>' +
      '<div class="text-xs text-slate-400 mt-1">Likely around <span class="text-gold font-medium">' + money(est.costLikely) + '</span> · ~' + est.weeks + ' weeks · ' + est.totalHours + ' hrs</div>' +
      (est.wantsSupport ? '<div class="text-xs text-slate-400 mt-2 pt-2 border-t border-gold/15">Ongoing support: <span class="text-white font-medium">' + money(est.maintMonthlyLow) + ' – ' + money(est.maintMonthlyHigh) + '/mo</span></div>' : '') +
      '</div>';

    // LOE table
    html += '<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-gold">Level of effort</div><div class="mb-4">';
    est.phases.forEach(function (p) { html += row(p.name, p.hours + ' hrs'); });
    html += row('<span class="text-white">Total</span>', '<span class="text-gold">' + est.totalHours + ' hrs</span>') + '</div>';

    // Cost analysis
    html += '<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-gold">Industry cost analysis</div><div class="mb-4">' +
      row('Conservative (' + '$85/hr' + ')', money(est.costLow)) +
      row('Likely ($120/hr)', money(est.costLikely)) +
      row('With contingency ($160/hr)', money(est.costHigh)) +
      (est.wantsSupport ? row('Maintenance / year', money(est.maintMonthlyLow * 12) + ' – ' + money(est.maintMonthlyHigh * 12)) : '') +
      '</div>' +
      '<p class="text-[11px] text-slate-500 -mt-2 mb-4">Based on blended industry agency rates of $' + est.rateBand + '/hr.</p>';

    // Tooling
    html += '<div class="mb-2 text-xs font-semibold uppercase tracking-wider text-gold">Recommended tooling</div><div class="space-y-2 mb-4">';
    est.tools.forEach(function (g) {
      html += '<div><span class="text-xs text-slate-400">' + g.name + ':</span> ' +
        g.items.map(function (t) { return '<span class="inline-block mt-1 mr-1 pill rounded-md px-2 py-0.5 text-xs text-slate-300">' + escapeHtml(t) + '</span>'; }).join('') + '</div>';
    });
    html += '</div>';

    // FSD (collapsible)
    html += '<details class="group mb-1"><summary class="cursor-pointer list-none text-xs font-semibold uppercase tracking-wider text-gold flex items-center gap-2">' +
      '<span>Functional spec outline</span><span class="text-slate-500 group-open:rotate-90 transition-transform">›</span></summary>' +
      '<div class="mt-3 space-y-3">';
    est.fsd.forEach(function (s) {
      html += '<div><div class="text-sm font-medium text-white">' + escapeHtml(s.h) + '</div>' +
        '<div class="text-xs text-slate-400 mt-1 whitespace-pre-line">' + escapeHtml(s.body) + '</div></div>';
    });
    html += '</div></details>';

    c.innerHTML = html;
    return c;
  }

  function renderBrief(est) {
    var row = el('div', 'msg msg-bot');
    var av = botAvatar(); av.style.background = 'linear-gradient(135deg,#FBBF24,#38BDF8)';
    var b = el('div', 'bubble', 'Here’s your draft brief — I’ll send a copy to <b>' + escapeHtml(state.answers.email || 'your inbox') + '</b>.');
    b.style.maxWidth = '100%';
    row.appendChild(av); row.appendChild(b);
    els.messages.appendChild(row);

    var card = briefCard(est);
    els.messages.appendChild(card);
    scrollDown();

    // Dock actions
    clearDock();
    var actions = el('div', 'space-y-2');
    var sendBtn = el('button', 'w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-ink cursor-pointer',
      'Send my brief to CCCM');
    sendBtn.type = 'button';
    sendBtn.addEventListener('click', function () { doSubmit(sendBtn); });

    var dlBtn = el('button', 'w-full rounded-xl pill px-4 py-2.5 text-sm font-semibold text-white cursor-pointer', 'Download brief (.md)');
    dlBtn.type = 'button';
    dlBtn.addEventListener('click', downloadBrief);

    var restart = el('button', 'w-full text-xs text-slate-500 hover:text-slate-300 cursor-pointer pt-1', 'Start over');
    restart.type = 'button';
    restart.addEventListener('click', resetIntake);

    actions.appendChild(sendBtn); actions.appendChild(dlBtn); actions.appendChild(restart);
    els.dock.appendChild(actions);
  }

  /* ----------------------------------------------------------------------- */
  /* Submission stub  (mailbox not built yet)                                */
  /* ----------------------------------------------------------------------- */
  function payload() {
    return { receivedAt: new Date().toISOString(), contact: { name: state.answers.name, email: state.answers.email, company: state.answers.company },
             answers: state.answers, estimate: state.estimate };
  }

  function submitIntake(data) {
    return fetch('/api/intake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
      .then(function (r) { if (!r.ok) throw new Error('no endpoint'); return { ok: true, via: 'api' }; })
      .catch(function () {
        // Mailbox isn't built yet — persist locally so nothing is lost.
        try { localStorage.setItem('cccm_intake_' + Date.now(), JSON.stringify(data)); } catch (e) {}
        return { ok: false, via: 'local' };
      });
  }

  function doSubmit(btn) {
    btn.disabled = true; btn.textContent = 'Sending…'; btn.classList.add('opacity-60');
    submitIntake(payload()).then(function (res) {
      typing(function () {
        if (res.via === 'api') {
          addBot('Done — your brief is in. Someone from CCCM will review it and reply to ' + (state.answers.email || 'your email') + ' within one business day.');
        } else {
          addBot('Got it. Our intake mailbox isn’t fully wired up yet, so I’ve saved your brief safely and prepared an email you can send us in one click — or download it below.');
          var mb = el('div', 'mt-2');
          var mail = el('a', 'inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2.5 text-sm font-semibold text-ink cursor-pointer', 'Email my brief to CCCM');
          mail.href = mailtoHref(); mail.style.textDecoration = 'none';
          mb.appendChild(mail);
          els.dock.innerHTML = ''; els.dock.appendChild(mb);
          var dl = el('button', 'w-full mt-2 rounded-xl pill px-4 py-2.5 text-sm font-semibold text-white cursor-pointer', 'Download brief (.md)');
          dl.type = 'button'; dl.addEventListener('click', downloadBrief); mb.appendChild(dl);
        }
      }, 600);
    });
  }

  function briefMarkdown() {
    var a = state.answers, e = state.estimate || {};
    var L = [];
    L.push('# CCCM Project Brief');
    L.push('');
    L.push('**Contact:** ' + (a.name || '') + ' <' + (a.email || '') + '>  ');
    L.push('**Company:** ' + (a.company || '') + ' — ' + (a.industry || ''));
    L.push('**Project:** ' + (a.projectKind || '') + '  ');
    L.push('');
    L.push('## Goal');
    L.push(a.goal || '');
    L.push('');
    L.push('## Estimate');
    if (e.phases) {
      L.push('- **Build cost:** ' + money(e.costLow) + ' – ' + money(e.costHigh) + ' (likely ' + money(e.costLikely) + ')');
      L.push('- **Effort:** ' + e.totalHours + ' hrs · ~' + e.weeks + ' weeks');
      if (e.wantsSupport) L.push('- **Support:** ' + money(e.maintMonthlyLow) + ' – ' + money(e.maintMonthlyHigh) + '/mo');
      L.push('');
      L.push('### Level of effort');
      e.phases.forEach(function (p) { L.push('- ' + p.name + ': ' + p.hours + ' hrs'); });
      L.push('');
      L.push('### Recommended tooling');
      e.tools.forEach(function (g) { L.push('- **' + g.name + ':** ' + g.items.join(', ')); });
      L.push('');
      L.push('### Functional spec outline');
      e.fsd.forEach(function (s) { L.push('#### ' + s.h); L.push(s.body); L.push(''); });
    }
    L.push('## Intake answers');
    Object.keys(a).forEach(function (k) { L.push('- **' + k + ':** ' + (Array.isArray(a[k]) ? a[k].join(', ') : a[k])); });
    return L.join('\n');
  }

  function downloadBrief() {
    var blob = new Blob([briefMarkdown()], { type: 'text/markdown' });
    var url = URL.createObjectURL(blob);
    var link = el('a'); link.href = url;
    link.download = 'cccm-brief-' + (state.answers.company || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.md';
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function mailtoHref() {
    var a = state.answers, e = state.estimate || {};
    var subject = 'New project intake — ' + (a.company || 'project');
    var body = 'Hi CCCM,\n\nHere is my project brief from Scout:\n\n' + briefMarkdown();
    return 'mailto:hello@cccm.consulting?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  /* ----------------------------------------------------------------------- */
  /* Open / close / reset                                                    */
  /* ----------------------------------------------------------------------- */
  function openIntake() {
    var root = els.root;
    root.classList.remove('hidden'); root.setAttribute('aria-hidden', 'false');
    // close mobile nav if open
    var mm = document.getElementById('mobileMenu'); if (mm) mm.classList.add('hidden');
    requestAnimationFrame(function () {
      els.overlay.classList.add('opacity-100');
      els.panel.classList.remove('translate-x-full');
    });
    document.body.style.overflow = 'hidden';
    if (!started) { started = true; advance(); }
  }

  function closeIntake() {
    els.overlay.classList.remove('opacity-100');
    els.panel.classList.add('translate-x-full');
    document.body.style.overflow = '';
    setTimeout(function () { els.root.classList.add('hidden'); els.root.setAttribute('aria-hidden', 'true'); }, 300);
  }

  function resetIntake() {
    state = { answers: {}, flags: {}, askedIds: [] };
    started = false;
    els.messages.innerHTML = '';
    clearDock();
    setProgress(0, 'Getting started');
    started = true; advance();
  }

  /* ----------------------------------------------------------------------- */
  /* Init                                                                    */
  /* ----------------------------------------------------------------------- */
  function init() {
    els.root = document.getElementById('intakeRoot');
    if (!els.root) return;
    els.overlay = document.getElementById('intakeOverlay');
    els.panel = document.getElementById('intakePanel');
    els.messages = document.getElementById('intakeMessages');
    els.dock = document.getElementById('intakeDock');
    els.bar = document.getElementById('intakeBar');
    els.pct = document.getElementById('intakePct');
    els.stage = document.getElementById('intakeStageLabel');

    document.querySelectorAll('[data-intake]').forEach(function (b) {
      b.addEventListener('click', openIntake);
    });
    document.getElementById('intakeClose').addEventListener('click', closeIntake);
    els.overlay.addEventListener('click', closeIntake);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !els.root.classList.contains('hidden')) closeIntake(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
