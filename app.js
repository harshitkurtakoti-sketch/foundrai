/**
 * FounderAI — Frontend Application & Simulation Engine
 * Enhanced Multi-Agent Boardroom Workspace with stage progress, reasoning chains,
 * agent filtering, and bidirectional charter-to-feed sync.
 */

// ── FounderAI Backend API ─────────────────────────────────────────────────────
const API_BASE = 'http://localhost:4000'; // Change to your Railway URL when deployed

// ── Auth State & Local Storage Fallback ───────────────────────────────────────
const Auth = {
  token: localStorage.getItem('foundrai_token') || null,
  user:  JSON.parse(localStorage.getItem('foundrai_user') || 'null'),

  get isLoggedIn() { return !!this.token && !!this.user; },

  save(token, user) {
    this.token = token;
    this.user  = user;
    localStorage.setItem('foundrai_token', token);
    localStorage.setItem('foundrai_user', JSON.stringify(user));
  },

  clear() {
    this.token = null;
    this.user  = null;
    localStorage.removeItem('foundrai_token');
    localStorage.removeItem('foundrai_user');
  },

  headers() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` };
  },

  // Local user directory for offline / local-first usage
  getLocalUsers() {
    try {
      return JSON.parse(localStorage.getItem('foundrai_local_users') || '[]');
    } catch {
      return [];
    }
  },

  saveLocalUsers(users) {
    localStorage.setItem('foundrai_local_users', JSON.stringify(users));
  }
};

// ── API Helpers with Automatic Local Fallback ──────────────────────────────────
async function apiPost(path, body) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(API_BASE + path, {
      method: 'POST',
      headers: Auth.isLoggedIn ? Auth.headers() : { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    // If it's a real API validation error from server (status 400/401/409), rethrow it
    if (err.message && !err.message.includes('fetch') && !err.message.includes('abort') && !err.message.includes('Failed') && !err.message.includes('NetworkError')) {
      throw err;
    }
    // Network / Server offline fallback
    return handleLocalAuthFallback(path, body);
  }
}

function handleLocalAuthFallback(path, body) {
  const users = Auth.getLocalUsers();

  if (path === '/auth/signup') {
    const email = (body.email || '').trim().toLowerCase();
    const existing = users.find(u => (u.email || '').toLowerCase() === email);
    if (existing) {
      throw new Error('An account with this email already exists');
    }
    const newUser = {
      id: 'usr_local_' + Math.random().toString(36).substr(2, 9),
      email,
      display_name: body.display_name || email.split('@')[0] || 'Founder',
      startup_idea: null,
      industry: null,
      stage: 'idea',
      password: body.password,
      created_at: new Date().toISOString()
    };
    users.push(newUser);
    Auth.saveLocalUsers(users);
    const token = 'token_local_' + Math.random().toString(36).substr(2, 16);
    const { password: _, ...safeUser } = newUser;
    return { token, user: safeUser, isLocal: true };
  }

  if (path === '/auth/login') {
    const email = (body.email || '').trim().toLowerCase();
    // Default founder demo bypass credentials
    if (email === 'founder@foundrai.com' || email === 'demo@foundrai.com') {
      const demoUser = {
        id: 'usr_demo_executive',
        email: email,
        display_name: 'Principal Founder',
        startup_idea: 'PulseAI',
        industry: 'Biometric AI',
        stage: 'idea',
        created_at: new Date().toISOString()
      };
      return { token: 'token_local_demo', user: demoUser, isLocal: true };
    }

    const user = users.find(u => (u.email || '').toLowerCase() === email);
    if (!user) {
      throw new Error('Account not found. Please create an account.');
    }
    if (user.password && user.password !== body.password) {
      throw new Error('Invalid password. Please try again.');
    }
    const token = 'token_local_' + Math.random().toString(36).substr(2, 16);
    const { password: _, ...safeUser } = user;
    return { token, user: safeUser, isLocal: true };
  }

  throw new Error('Backend service unavailable. Using local offline storage.');
}

async function apiGet(path) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(API_BASE + path, { headers: Auth.headers(), signal: controller.signal });
    clearTimeout(timeoutId);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    // Fallback to local sessions
    if (path === '/chats') {
      return JSON.parse(localStorage.getItem('foundrai_local_chats') || '[]');
    }
    if (path.startsWith('/chats/') && path.endsWith('/messages')) {
      const parts = path.split('/');
      const chatId = parts[2];
      const allMsgs = JSON.parse(localStorage.getItem('foundrai_local_msgs') || '{}');
      return allMsgs[chatId] || [];
    }
    throw err;
  }
}

async function apiDelete(path) {
  try {
    const res = await fetch(API_BASE + path, { method: 'DELETE', headers: Auth.headers() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  } catch (err) {
    if (path.startsWith('/chats/')) {
      const id = path.split('/')[2];
      const chats = JSON.parse(localStorage.getItem('foundrai_local_chats') || '[]').filter(c => c.id !== id);
      localStorage.setItem('foundrai_local_chats', JSON.stringify(chats));
      return { success: true };
    }
    throw err;
  }
}

// ── Auth UI Helpers ───────────────────────────────────────────────────────────
function showAuthMessage(text, type = 'error') {
  const el = document.getElementById('auth-message');
  if (!el) return;
  el.textContent = text;
  el.className = `auth-message ${type}`;
  el.style.display = 'block';
}

function hideAuthMessage() {
  const el = document.getElementById('auth-message');
  if (el) el.style.display = 'none';
}

function setSubmitLoading(btnId, loading, defaultText) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.disabled = loading;
  btn.textContent = loading ? 'Please wait...' : defaultText;
}

// ── Chat Session API ──────────────────────────────────────────────────────────
const ChatAPI = {
  currentChatId: null,

  async loadAll() {
    if (!Auth.isLoggedIn) return [];
    try {
      return await apiGet('/chats');
    } catch {
      return JSON.parse(localStorage.getItem('foundrai_local_chats') || '[]');
    }
  },

  async create(title) {
    if (!Auth.isLoggedIn) return null;
    const fallbackChat = {
      id: 'chat_' + Math.random().toString(36).substr(2, 9),
      title: title || 'New Session',
      created_at: new Date().toISOString()
    };
    try {
      const chat = await apiPost('/chats', { title });
      this.currentChatId = chat.id || fallbackChat.id;
      return chat;
    } catch {
      const chats = JSON.parse(localStorage.getItem('foundrai_local_chats') || '[]');
      chats.unshift(fallbackChat);
      localStorage.setItem('foundrai_local_chats', JSON.stringify(chats));
      this.currentChatId = fallbackChat.id;
      return fallbackChat;
    }
  },

  async delete(id) {
    try {
      await apiDelete(`/chats/${id}`);
    } catch (e) {
      console.warn('Delete chat local fallback:', e);
    }
    const chats = JSON.parse(localStorage.getItem('foundrai_local_chats') || '[]').filter(c => c.id !== id);
    localStorage.setItem('foundrai_local_chats', JSON.stringify(chats));
    if (this.currentChatId === id) this.currentChatId = null;
  },

  async getMessages(id) {
    try {
      return await apiGet(`/chats/${id}/messages`);
    } catch {
      const allMsgs = JSON.parse(localStorage.getItem('foundrai_local_msgs') || '{}');
      return allMsgs[id] || [];
    }
  },

  async saveMessage(role, content, agent = null) {
    if (!this.currentChatId || !Auth.isLoggedIn) return;
    const msgObj = {
      id: 'msg_' + Math.random().toString(36).substr(2, 9),
      role,
      agent: agent || null,
      content,
      created_at: new Date().toISOString()
    };
    // Save locally
    const allMsgs = JSON.parse(localStorage.getItem('foundrai_local_msgs') || '{}');
    if (!allMsgs[this.currentChatId]) allMsgs[this.currentChatId] = [];
    allMsgs[this.currentChatId].push(msgObj);
    localStorage.setItem('foundrai_local_msgs', JSON.stringify(allMsgs));

    try {
      await apiPost(`/chats/${this.currentChatId}/messages`, { role, content, agent });
    } catch (e) {
      // Offline fallback already stored message locally
    }
  },

  async openSession(chatId, title) {
    this.currentChatId = chatId;
    resetBoardroom();
    switchView('boardroom');
    const topicTitle = document.getElementById('boardroom-topic-title');
    if (topicTitle && title) topicTitle.textContent = title;

    try {
      const messages = await this.getMessages(chatId);
      if (messages && messages.length > 0) {
        messages.forEach(msg => {
          addMessage(msg.agent || (msg.role === 'user' ? 'user' : 'ceo'), '', msg.content, { skipSave: true });
        });
      }
    } catch (err) {
      console.warn('Failed to load session messages:', err);
    }
  }
};

// ── Profile Page Updater ──────────────────────────────────────────────────────
function updateProfilePage(user) {
  if (!user) return;
  const nameEl    = document.getElementById('profile-display-name');
  const emailEl   = document.getElementById('profile-email-line');
  const avatarEl  = document.getElementById('profile-avatar-initials');
  const userLabel = document.querySelector('.header-user-label');

  if (nameEl)    nameEl.textContent  = user.display_name || 'Founder';
  if (emailEl)   emailEl.textContent = user.email || '';
  if (avatarEl)  avatarEl.textContent = (user.display_name || 'FA').slice(0, 2).toUpperCase();
  if (userLabel) userLabel.textContent = user.display_name ? user.display_name.split(' ')[0] : 'Founder';
}

async function renderChatHistory() {
  const list = document.getElementById('chat-history-list');
  if (!list) return;

  if (!Auth.isLoggedIn) {
    list.innerHTML = '<div style="font-size:0.85rem;color:var(--ink-muted);padding:12px 0;">Sign in to see your sessions.</div>';
    return;
  }

  list.innerHTML = '<div style="font-size:0.85rem;color:var(--ink-muted);padding:8px 0;">Loading sessions...</div>';

  const chats = await ChatAPI.loadAll();

  if (chats.length === 0) {
    list.innerHTML = '<div style="font-size:0.85rem;color:var(--ink-muted);padding:12px 0;">No sessions yet. Start a new boardroom session!</div>';
    return;
  }

  list.innerHTML = chats.map(chat => {
    const date = new Date(chat.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return `
      <div class="chat-history-item" data-chat-id="${chat.id}" data-chat-title="${escapeHtml(chat.title)}">
        <span class="chat-history-title">${escapeHtml(chat.title)}</span>
        <span class="chat-history-date">${date}</span>
        <button class="btn-delete-chat" data-delete-chat="${chat.id}" title="Delete session">✕</button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.chat-history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.btn-delete-chat')) return;
      const chatId = item.getAttribute('data-chat-id');
      const title = item.getAttribute('data-chat-title');
      ChatAPI.openSession(chatId, title);
    });
  });

  list.querySelectorAll('.btn-delete-chat').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-delete-chat');
      if (!confirm('Delete this session?')) return;
      try {
        await ChatAPI.delete(id);
        renderChatHistory();
      } catch (err) {
        alert('Failed to delete: ' + err.message);
      }
    });
  });
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Bootstrap Auth on Page Load ───────────────────────────────────────────────
function bootstrapAuth() {
  if (Auth.isLoggedIn) {
    state.isAuthenticated = true;
    updateProfilePage(Auth.user);
  }

  // Tab switcher
  document.getElementById('tab-signin')?.addEventListener('click', () => {
    document.getElementById('tab-signin').classList.add('active');
    document.getElementById('tab-signup').classList.remove('active');
    document.getElementById('form-signin').style.display = '';
    document.getElementById('form-signup').style.display = 'none';
    hideAuthMessage();
  });

  document.getElementById('tab-signup')?.addEventListener('click', () => {
    document.getElementById('tab-signup').classList.add('active');
    document.getElementById('tab-signin').classList.remove('active');
    document.getElementById('form-signup').style.display = '';
    document.getElementById('form-signin').style.display = 'none';
    hideAuthMessage();
  });

  // Sign In
  document.getElementById('form-signin')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthMessage();
    const email    = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;
    setSubmitLoading('btn-signin-submit', true, 'Sign In → Boardroom');
    try {
      const { token, user } = await apiPost('/auth/login', { email, password });
      Auth.save(token, user);
      state.isAuthenticated = true;
      updateProfilePage(user);
      showAuthMessage('Welcome back, ' + (user.display_name || 'Founder') + '!', 'success');
      setTimeout(() => {
        hideAuthMessage();
        switchView(state.pendingPrompt ? 'boardroom' : 'boardroom');
        if (state.pendingPrompt) {
          const p = state.pendingPrompt;
          state.pendingPrompt = '';
          runSimulation(p);
        }
      }, 800);
    } catch (err) {
      showAuthMessage(err.message, 'error');
    } finally {
      setSubmitLoading('btn-signin-submit', false, 'Sign In → Boardroom');
    }
  });

  // Sign Up
  document.getElementById('form-signup')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthMessage();
    const name     = document.getElementById('signup-name').value.trim();
    const email    = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    setSubmitLoading('btn-signup-submit', true, 'Create Account →');
    try {
      const { token, user } = await apiPost('/auth/signup', { email, password, display_name: name });
      Auth.save(token, user);
      state.isAuthenticated = true;
      updateProfilePage(user);
      showAuthMessage('Account created! Welcome, ' + (user.display_name || 'Founder') + '!', 'success');
      setTimeout(() => { hideAuthMessage(); switchView('boardroom'); }, 800);
    } catch (err) {
      showAuthMessage(err.message, 'error');
    } finally {
      setSubmitLoading('btn-signup-submit', false, 'Create Account →');
    }
  });

  // Instant Demo Bypass
  document.getElementById('btn-login-bypass')?.addEventListener('click', () => {
    const demoUser = {
      id: 'usr_demo_executive',
      email: 'founder@foundrai.com',
      display_name: 'Principal Founder',
      startup_idea: 'PulseAI',
      industry: 'Biometric AI',
      stage: 'idea',
      created_at: new Date().toISOString()
    };
    Auth.save('token_demo_bypass', demoUser);
    state.isAuthenticated = true;
    updateProfilePage(demoUser);
    switchView('boardroom');
    if (state.pendingPrompt) {
      const p = state.pendingPrompt;
      const preset = state.pendingPreset || 'fitness';
      state.pendingPrompt = '';
      runSimulation(p, preset);
    }
  });

  // Sign Out (header + profile page button)
  document.getElementById('btn-header-signout')?.addEventListener('click', doSignOut);
  document.getElementById('btn-profile-signout')?.addEventListener('click', doSignOut);

  // New Chat button on profile
  document.getElementById('btn-new-chat')?.addEventListener('click', () => {
    ChatAPI.currentChatId = null;
    switchView('boardroom');
  });
}

function doSignOut() {
  Auth.clear();
  state.isAuthenticated = false;
  ChatAPI.currentChatId = null;
  resetBoardroom();
  switchView('landing');
}


// ── AI Engine Configuration ──────────────────────────────────────────────────
// Groq AI API Configuration (Autonomous Multi-Agent Executive Intelligence)
const GROQ_CONFIG = {
  apiKey: (typeof window !== 'undefined' && window.GROQ_API_KEY) || 
          (typeof localStorage !== 'undefined' && localStorage.getItem('foundrai_groq_api_key')) || 
          '',
  endpoint: 'https://api.groq.com/openai/v1/chat/completions',
  model: 'openai/gpt-oss-120b',
  fallbackModel: 'qwen/qwen3.8-27b'
};

// ── Supabase Cloud Database Configuration ─────────────────────────────────────
const SUPABASE_CONFIG = {
  url: (typeof window !== 'undefined' && window.SUPABASE_URL) || 
       (typeof localStorage !== 'undefined' && localStorage.getItem('foundrai_supabase_url')) || '',
  anonKey: (typeof window !== 'undefined' && window.SUPABASE_ANON_KEY) || 
           (typeof localStorage !== 'undefined' && localStorage.getItem('foundrai_supabase_key')) || ''
};

let supabaseClient = null;

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  const url = SUPABASE_CONFIG.url || (typeof localStorage !== 'undefined' && localStorage.getItem('foundrai_supabase_url'));
  const key = SUPABASE_CONFIG.anonKey || (typeof localStorage !== 'undefined' && localStorage.getItem('foundrai_supabase_key'));
  
  if (url && key && typeof window !== 'undefined' && window.supabase && window.supabase.createClient) {
    try {
      supabaseClient = window.supabase.createClient(url, key);
      return supabaseClient;
    } catch (e) {
      console.warn('Supabase initialization failed:', e);
    }
  }
  return null;
}

async function saveCharterToSupabase(ventureTopic, founderPrompt, steps, charterData) {
  const client = getSupabaseClient();
  if (!client) {
    console.log('Supabase not connected. Storing charter locally.');
    return;
  }

  try {
    const payload = {
      topic: ventureTopic,
      prompt: founderPrompt,
      charter_vision: charterData.vision || '',
      charter_market: charterData.market || '',
      charter_architecture: charterData.architecture || '',
      charter_gtm: charterData.gtm || '',
      charter_economics: charterData.economics || '',
      charter_compliance: charterData.compliance || '',
      charter_design: charterData.design || '',
      raw_steps: steps,
      created_at: new Date().toISOString()
    };

    const { data, error } = await client.from('charters').insert([payload]);
    if (error) {
      console.warn('Supabase save error (ensure "charters" table exists):', error.message);
    } else {
      console.log('Successfully saved charter to Supabase:', data);
    }
  } catch (err) {
    console.warn('Supabase write exception:', err);
  }
}

// Agent Meta Registry
const AGENT_REGISTRY = {
  ceo: {
    name: 'CEO Agent',
    role: 'Orchestration & Executive Synthesis',
    colorVar: 'var(--agent-ceo)',
    tag: 'Executive'
  },
  research: {
    name: 'Research Agent',
    role: 'Market, Trend & Competitor Intelligence',
    colorVar: 'var(--agent-research)',
    tag: 'Intelligence'
  },
  engineer: {
    name: 'Software Engineer Agent',
    role: 'System Architecture & Technical Stack',
    colorVar: 'var(--agent-engineer)',
    tag: 'Architecture'
  },
  marketing: {
    name: 'Marketing Agent',
    role: 'Positioning, Brand & GTM Launch Strategy',
    colorVar: 'var(--agent-marketing)',
    tag: 'Growth'
  },
  finance: {
    name: 'Finance Agent',
    role: 'Unit Economics, Pricing & Financial Model',
    colorVar: 'var(--agent-finance)',
    tag: 'Capital'
  },
  legal: {
    name: 'Legal Agent',
    role: 'Compliance, IP Framework & Terms of Service',
    colorVar: 'var(--agent-legal)',
    tag: 'Compliance'
  },
  designer: {
    name: 'Designer Agent',
    role: 'Brand Identity & User Experience Direction',
    colorVar: 'var(--agent-designer)',
    tag: 'Design System'
  }
};

// Application State
const state = {
  currentView: 'landing', // 'landing' | 'login' | 'boardroom' | 'profile'
  isAuthenticated: false,
  isSimulating: false,
  simulationTimer: null,
  activeTopic: '',
  activeFilter: null, // null or agentId string
  currentPhase: 1,
  pendingPrompt: '',
  pendingPreset: 'fitness',
  agentStatuses: {
    ceo: 'idle',
    research: 'idle',
    engineer: 'idle',
    marketing: 'idle',
    finance: 'idle',
    legal: 'idle',
    designer: 'idle'
  },
  charterData: {
    vision: '',
    market: '',
    architecture: '',
    gtm: '',
    economics: '',
    compliance: '',
    design: ''
  }
};

// Preset Scenarios with Enhanced Reasoning Chains
const PRESETS = {
  fitness: {
    topic: 'PulseAI: Adaptive Biometric Fitness & Nutrition Co-Pilot',
    prompt: 'I want to build an AI fitness companion that syncs with Apple Watch & Whoop to create real-time dynamic workout and meal adjustments.',
    steps: [
      {
        agent: 'ceo',
        phase: 1,
        time: '00:01',
        title: 'Executive Charter & Delegation Brief',
        reasoning: 'Synthesizing founder directive: High-growth biometric market, zero-hardware barrier, needs strict medical disclaimer and high LTV/CAC retention moat.',
        content: `
          <p><strong>Executive Directive:</strong> We are launching <em>PulseAI</em> — a hyper-personalized, biometric-driven health companion targeting premium performance athletes and busy professionals.</p>
          <p><strong>Operational Mandates:</strong></p>
          <ul>
            <li><strong>Research:</strong> Map competitive landscape against Whoop Coach, Apple Fitness+, and Freeletics. Identify churn vulnerabilities.</li>
            <li><strong>Engineering:</strong> Outline real-time health data ingestion engine (HealthKit / Google Health Connect) with local-first inference.</li>
            <li><strong>Marketing:</strong> Build high-converting B2C waitlist strategy and micro-influencer fitness creator affiliate loop.</li>
            <li><strong>Finance:</strong> Model $19.99/mo subscription tier vs $149/yr annual pass with CAC payback targets &lt; 4 months.</li>
            <li><strong>Legal:</strong> Draft HIPAA/GDPR health telemetry storage boundaries and clear "Not Medical Advice" liability shield.</li>
            <li><strong>Designer:</strong> Specify high-contrast, glanceable telemetry dashboard with minimal cognitive load during workouts.</li>
          </ul>
        `
      },
      {
        agent: 'research',
        phase: 2,
        time: '00:03',
        title: 'Market Intelligence & Competitive Landscape',
        reasoning: 'Audited 18 direct/indirect competitors. Key moat identified: Consumers resent $30/mo proprietary bands (Whoop); open API biometric integration solves adoption friction.',
        content: `
          <p>Completed competitive benchmarking across 18 fitness intelligence apps:</p>
          <table>
            <thead>
              <tr>
                <th>Competitor</th>
                <th>Price Point</th>
                <th>Core Weakness</th>
                <th>PulseAI Advantage</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Whoop Coach</td>
                <td>$30/mo</td>
                <td>Requires $200+ proprietary hardware band</td>
                <td>Hardware-agnostic (Apple, Garmin, Oura)</td>
              </tr>
              <tr>
                <td>Freeletics</td>
                <td>$12/mo</td>
                <td>Static algorithmic plans, no real-time biometric adapt</td>
                <td>Intra-workout exertion autoregulation</td>
              </tr>
              <tr>
                <td>Fitbod</td>
                <td>$15/mo</td>
                <td>Lacks holistic recovery and metabolic nutrition context</td>
                <td>Unified sleep, strain, and macronutrient engine</td>
              </tr>
            </tbody>
          </table>
          <p><strong>Target Beachhead:</strong> 2.4M hybrid athletes (CrossFit / Hyrox / Marathon runners) who already wear smartwatches but lack unified intelligent coaching.</p>
        `,
        charterKey: 'market',
        charterSnippet: 'TAM: $14.2B global fitness software. Target beachhead: 2.4M hybrid athletes seeking unified recovery & real-time strain adjustment across standard smartwatches.'
      },
      {
        agent: 'engineer',
        phase: 2,
        time: '00:06',
        title: 'System Architecture & Data Pipeline',
        reasoning: 'Engineered sub-10ms latency loop. Raw high-frequency accelerometer streams processed on-device (CoreML); only aggregated telemetry frames sync to backend.',
        content: `
          <p><strong>Recommended Core Architecture:</strong></p>
          <pre><code>[Wearable Sensor Feed] ──(Bluetooth LE)──> [Mobile Client (Swift/Kotlin)]
                                                    │
                   ┌────────────────────────────────┴────────────────────────┐
                   ▼                                                         ▼
    [Local On-Device Filtering]                                 [Encrypted Telemetry Sync]
    • HRV anomaly detection                                     • gRPC / Protobuf
    • Real-time rep cadence                                     • TimeScaleDB Time-Series
                                                                             │
                                                                             ▼
                                                                [Adaptive LLM Agent Pipeline]
                                                                • FastAPI + PyTorch Serving
                                                                • Redis Vector Recovery Cache</code></pre>
          <p><strong>Key Technical Decisions:</strong></p>
          <ul>
            <li><strong>Local Sensor Processing:</strong> Run accelerometer & gyroscope peak-detection directly on-device using CoreML to maintain zero latency without cellular connectivity.</li>
            <li><strong>Privacy-Preserving Telemetry:</strong> All biometric payload frames encrypted using AES-256 with user-controlled private keys.</li>
          </ul>
        `,
        charterKey: 'architecture',
        charterSnippet: 'Event-driven time-series pipeline (FastAPI + TimescaleDB) coupled with CoreML on-device inference for real-time sensor processing and zero-latency feedback.'
      },
      {
        agent: 'designer',
        phase: 2,
        time: '00:09',
        title: 'Design System & Interaction Blueprint',
        reasoning: 'User ergonomics in high-strain environments: Heart rate >160bpm impairs fine motor control. Mandated large tap targets (minimum 48x48pt) and high-contrast dark telemetry.',
        content: `
          <p><strong>Visual Metaphor:</strong> "Cockpit Instrumentation for Human Biology." Avoid loud neon gradients that cause visual fatigue during high-strain activity.</p>
          <ul>
            <li><strong>Palette:</strong> Deep Slate Canvas (<code>#0D1117</code>), Hyper-Readable Electric Mint (<code>#00E599</code>) for active strain metrics, Crisp Milk (<code>#F0F6FC</code>) for typography.</li>
            <li><strong>Typography:</strong> <em>JetBrains Mono</em> for all numerical telemetry; <em>Inter</em> for contextual coaching insights.</li>
            <li><strong>One-Thumb Navigation:</strong> Primary controls located in bottom 35% of the screen; high-friction gym environment usability.</li>
          </ul>
        `,
        charterKey: 'design',
        charterSnippet: 'Glanceable dark telemetry interface with high-contrast biological telemetry metrics, zero visual noise, and one-thumb reachable controls.'
      },
      {
        agent: 'marketing',
        phase: 2,
        time: '00:12',
        title: 'Go-To-Market & Growth Architecture',
        reasoning: 'Organic distribution engine modeled around Strava / Instagram workout shareability with viral squad leaderboard mechanics.',
        content: `
          <p><strong>Phase 1: Founder-Led Beachhead (Months 1–3)</strong></p>
          <ul>
            <li><strong>Strava & Garmin Integration Hook:</strong> "Auto-generated biometric workout retrospectives" that users can share with one tap to Instagram Stories & Strava feed.</li>
            <li><strong>Creator Co-Op:</strong> Seed 50 mid-tier CrossFit & marathon coaches with lifetime executive access in exchange for weekly training breakdowns.</li>
            <li><strong>Viral Waitlist Mechanics:</strong> Move up 50 spots for every workout buddy onboarded to a private squad.</li>
          </ul>
        `,
        charterKey: 'gtm',
        charterSnippet: 'GTM Strategy: Strava auto-retrospective sharing loops, 50-coach creator seeding program, and tiered private squad waitlist mechanics.'
      },
      {
        agent: 'finance',
        phase: 3,
        time: '00:15',
        title: 'Unit Economics & Financial Projections',
        reasoning: 'Benchmarked against SaaS fitness benchmarks (Strava, WHOOP, Peloton). Target LTV:CAC of 5.81x with 14-month retention baseline.',
        content: `
          <p><strong>Core Unit Economics Model:</strong></p>
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th>Conservative</th>
                <th>Target</th>
                <th>Aggressive</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Monthly ARPU</td>
                <td>$14.99</td>
                <td>$19.99</td>
                <td>$24.99</td>
              </tr>
              <tr>
                <td>Customer Acquisition Cost (CAC)</td>
                <td>$62.00</td>
                <td>$48.00</td>
                <td>$35.00</td>
              </tr>
              <tr>
                <td>Estimated LTV (14-mo avg)</td>
                <td>$209.00</td>
                <td>$279.00</td>
                <td>$349.00</td>
              </tr>
              <tr>
                <td>LTV : CAC Ratio</td>
                <td>3.37x</td>
                <td>5.81x</td>
                <td>9.97x</td>
              </tr>
            </tbody>
          </table>
          <p><strong>12-Month Break-Even Target:</strong> 4,200 active paying subscribers required to cover server infrastructure, model API inference, and 3 full-time core engineers.</p>
        `,
        disclaimer: 'Financial estimates and unit economics projections are generated for strategic planning purposes only and do not constitute certified financial or investment advice.',
        charterKey: 'economics',
        charterSnippet: 'Target ARPU: $19.99/mo | Estimated LTV: $279 | LTV:CAC 5.8x | Break-even requirement: 4,200 active paid subscribers.'
      },
      {
        agent: 'legal',
        phase: 3,
        time: '00:18',
        title: 'Regulatory, Privacy & IP Safeguards',
        reasoning: 'Constructed multi-jurisdiction risk buffer: FDA 21 CFR § 860 wellness boundaries, HIPAA safe-harbor, and GDPR Article 9 explicit biometric consent protocol.',
        content: `
          <p><strong>Key Compliance Frameworks:</strong></p>
          <ul>
            <li><strong>Non-Diagnostic Health Disclaimer:</strong> Clear statutory barrier categorizing PulseAI as a wellness tool rather than an FDA-regulated medical diagnostic device under 21 CFR § 860.</li>
            <li><strong>GDPR Article 9 (Special Category Data):</strong> Explicit, separate user consent checkbox for processing biometric data with immediate, one-click permanent data erasure capability.</li>
            <li><strong>Algorithmic IP Protection:</strong> Proprietary dynamic training autoregulation weights kept server-side; client binary contains no proprietary weighting logic.</li>
          </ul>
        `,
        disclaimer: 'Legal agent outputs provide generalized informational frameworks only and do not constitute formal legal counsel. Always engage qualified legal counsel for jurisdiction-specific compliance.',
        charterKey: 'compliance',
        charterSnippet: 'FDA wellness exemption positioning (21 CFR § 860), GDPR Article 9 explicit biometric consent protocol, and server-side IP isolation.'
      },
      {
        agent: 'ceo',
        phase: 4,
        time: '00:21',
        title: 'Final Synthesis & Executive Approval',
        reasoning: 'Synthesizing all 6 specialist outputs into FounderAI Master Startup Charter #0482. Ratified for immediate execution.',
        content: `
          <p><strong>Executive Summary & Synthesis:</strong> All operational directives have been delivered and verified across research, engineering, design, marketing, finance, and compliance.</p>
          <p>The <strong>PulseAI Master Startup Charter</strong> is now compiled and ready for founder execution. Review the completed summary in the right-hand panel or export the full charter dossier.</p>
        `,
        charterKey: 'vision',
        charterSnippet: 'PulseAI is positioned as the definitive hardware-agnostic biometric co-pilot with unit economics targeting 5.8x LTV:CAC and clean regulatory shielding.'
      }
    ]
  },
  b2b: {
    topic: 'LeadForge: Autonomous B2B Pipeline Intelligence Agent',
    prompt: 'I want to build an autonomous agent that enriches inbound sales leads and crafts hyper-personalized multi-channel outreach sequences.'
  },
  dtc: {
    topic: 'RoastClub: Algorithmically Tuned Micro-Lot Coffee Subscription',
    prompt: 'I want to launch a specialty coffee subscription that calibrates roast profiles to user brewing methods and flavor surveys.'
  }
};

// DOM Elements
const views = {
  landing: document.getElementById('view-landing'),
  login: document.getElementById('view-login'),
  boardroom: document.getElementById('view-boardroom'),
  profile: document.getElementById('view-profile')
};

// Update Dynamic Header State
function updateHeaderAuthState() {
  const guestHeader = document.getElementById('header-actions-guest');
  const authHeader = document.getElementById('header-actions-auth');
  const boardroomBtn = document.getElementById('btn-header-boardroom');

  if (state.isAuthenticated) {
    if (guestHeader) guestHeader.style.display = 'none';
    if (authHeader) authHeader.style.display = 'flex';
    if (boardroomBtn) {
      boardroomBtn.style.display = state.currentView === 'boardroom' ? 'none' : 'inline-flex';
    }
  } else {
    if (guestHeader) guestHeader.style.display = 'flex';
    if (authHeader) authHeader.style.display = 'none';
  }
}

// Navigation
function switchView(viewName) {
  if (viewName === 'profile' && !Auth.isLoggedIn) {
    viewName = 'login';
  }

  state.currentView = viewName;
  state.isAuthenticated = Auth.isLoggedIn;

  // Toggle View Containers
  Object.keys(views).forEach(key => {
    if (views[key]) {
      views[key].classList.toggle('active', key === viewName);
    }
  });

  // Update floating demo buttons if present
  document.querySelectorAll('.demo-view-btn').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
  });

  if (viewName === 'boardroom') {
    switchBoardroomMobileTab('feed');
  }
  if (viewName === 'profile') {
    renderChatHistory();
  }

  updateHeaderAuthState();

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Mobile Boardroom Panel Switcher
function switchBoardroomMobileTab(tabName) {
  const feedPanel = document.getElementById('boardroom-feed-panel');
  const sidebarPanel = document.getElementById('boardroom-sidebar-panel');
  const charterPanel = document.getElementById('boardroom-charter-panel');
  const tabs = document.querySelectorAll('.boardroom-mobile-tab');

  tabs.forEach(tab => {
    tab.classList.toggle('active', tab.getAttribute('data-boardroom-tab') === tabName);
  });

  if (feedPanel) feedPanel.classList.toggle('mobile-panel-active', tabName === 'feed');
  if (sidebarPanel) sidebarPanel.classList.toggle('mobile-panel-active', tabName === 'roster');
  if (charterPanel) charterPanel.classList.toggle('mobile-panel-active', tabName === 'charter');
}

// Sign Out Handler
function signOut() {
  state.isAuthenticated = false;
  state.pendingPrompt = '';
  resetBoardroom();
  switchView('landing');
}

// Profile Quick Launch
window.loadPresetFromProfile = function(presetKey) {
  const preset = PRESETS[presetKey];
  if (preset) {
    switchView('boardroom');
    switchBoardroomMobileTab('feed');
    runSimulation(preset.prompt, presetKey);
  }
};

// Update Stage Progress Bar
function setStage(stageNumber) {
  state.currentPhase = stageNumber;
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`stage-${i}`);
    if (!el) continue;
    if (i < stageNumber) {
      el.className = 'stage-step completed';
    } else if (i === stageNumber) {
      el.className = 'stage-step active';
    } else {
      el.className = 'stage-step';
    }
  }
}

// Update Agent Sidebar Status
function setStatus(agentId, status) {
  if (!AGENT_REGISTRY[agentId]) return;
  state.agentStatuses[agentId] = status;

  // Update sidebar dots in Boardroom
  const item = document.querySelector(`.sidebar-agent-item[data-agent="${agentId}"]`);
  if (item) {
    const dot = item.querySelector('.status-dot');
    const label = item.querySelector('.sidebar-status-text');
    if (dot) {
      dot.className = `status-dot ${status}`;
    }
    if (label) {
      label.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }
  }

  // Update Roster dots on Landing page if present
  const rosterEntry = document.querySelector(`.roster-entry[data-agent="${agentId}"]`);
  if (rosterEntry) {
    const rDot = rosterEntry.querySelector('.status-dot');
    const rLabel = rosterEntry.querySelector('.status-text');
    if (rDot) rDot.className = `status-dot ${status}`;
    if (rLabel) rLabel.textContent = status.charAt(0).toUpperCase() + status.slice(1);
  }
}

// Filter Feed by Agent
function filterFeed(agentId) {
  state.activeFilter = agentId;
  const feed = document.getElementById('boardroom-feed');
  const filterBadge = document.getElementById('sidebar-filter-badge');
  const filterText = document.getElementById('sidebar-filter-text');

  document.querySelectorAll('.sidebar-agent-item').forEach(item => {
    item.classList.toggle('selected', item.getAttribute('data-agent') === agentId);
  });

  if (agentId) {
    const agent = AGENT_REGISTRY[agentId];
    if (filterBadge) filterBadge.classList.add('active');
    if (filterText) filterText.textContent = `Showing: ${agent ? agent.name : agentId}`;
    
    if (feed) {
      feed.querySelectorAll('.meeting-note').forEach(note => {
        const noteAgent = note.getAttribute('data-agent');
        note.style.display = (noteAgent === agentId || noteAgent === 'user') ? 'block' : 'none';
      });
    }
  } else {
    if (filterBadge) filterBadge.classList.remove('active');
    if (feed) {
      feed.querySelectorAll('.meeting-note').forEach(note => {
        note.style.display = 'block';
      });
    }
  }

  // On mobile screens, automatically switch to deliberation feed tab to see results
  if (window.innerWidth < 992) {
    switchBoardroomMobileTab('feed');
    if (feed) {
      feed.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}

// Add Structured Meeting Note Message to Feed
function addMessage(agentId, title, content, meta = {}) {
  const feed = document.getElementById('boardroom-feed');
  if (!feed) return;

  const agent = AGENT_REGISTRY[agentId] || {
    name: agentId === 'user' ? 'Founder' : 'System',
    role: agentId === 'user' ? 'Product Visionary' : 'Orchestration',
    tag: agentId === 'user' ? 'Founder' : 'Notice'
  };

  const timeStr = meta.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const noteDiv = document.createElement('div');
  noteDiv.className = 'meeting-note';
  noteDiv.setAttribute('data-agent', agentId);
  noteDiv.id = `note-${agentId}-${Date.now()}`;

  let disclaimerHtml = '';
  if (meta.disclaimer) {
    disclaimerHtml = `
      <div class="disclaimer-banner">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span><strong>Regulatory Disclaimer:</strong> ${meta.disclaimer}</span>
      </div>
    `;
  }

  let reasoningHtml = '';
  if (meta.reasoning) {
    reasoningHtml = `
      <div class="agent-reasoning-toggle" onclick="this.nextElementSibling.classList.toggle('open')">
        <span>🧠 Agent Reasoning / Heuristic Chain ▸</span>
      </div>
      <div class="agent-reasoning-content">
        ${meta.reasoning}
      </div>
    `;
  }

  let actionsHtml = '';
  if (agentId !== 'user') {
    actionsHtml = `
      <div class="note-actions-bar">
        <button class="note-action-btn" onclick="directQueryAgent('${agentId}')">💬 Direct Follow-up</button>
        <button class="note-action-btn" onclick="copyNoteContent(this)">📋 Copy Section</button>
      </div>
    `;
  }

  noteDiv.innerHTML = `
    <div class="note-header">
      <div class="note-agent-meta">
        <span class="note-agent-badge">${agent.name}</span>
        <span class="roster-role-subtitle">${agent.role}</span>
      </div>
      <div class="note-time">${timeStr}</div>
    </div>
    <div class="note-body">
      ${reasoningHtml}
      ${title ? `<h4 style="margin-bottom: 8px; font-family: var(--font-serif);">${title}</h4>` : ''}
      ${content}
      ${disclaimerHtml}
      ${actionsHtml}
    </div>
  `;

  feed.appendChild(noteDiv);
  
  // If active filter is on, adjust visibility
  if (state.activeFilter && state.activeFilter !== agentId && agentId !== 'user') {
    noteDiv.style.display = 'none';
  }

  feed.scrollTop = feed.scrollHeight;

  // Auto-save message to database if active chat session exists
  if (!meta.skipSave && Auth.isLoggedIn && ChatAPI.currentChatId) {
    ChatAPI.saveMessage(agentId === 'user' ? 'user' : 'agent', content, agentId);
  }
}

// Quick action: Direct query an agent
window.directQueryAgent = function(agentId) {
  const input = document.getElementById('boardroom-input');
  const agent = AGENT_REGISTRY[agentId];
  if (input && agent) {
    input.value = `@${agent.name}: `;
    input.focus();
  }
};

// Quick action: Copy note content
window.copyNoteContent = function(btn) {
  const noteBody = btn.closest('.note-body');
  if (noteBody) {
    navigator.clipboard.writeText(noteBody.innerText);
    const orig = btn.innerText;
    btn.innerText = '✓ Copied!';
    setTimeout(() => { btn.innerText = orig; }, 1500);
  }
};

// Update Charter Summary in Right Panel
function updateCharterSnippet(key, text) {
  if (!key || !text) return;
  state.charterData[key] = text;
  
  const block = document.querySelector(`.charter-section-block[data-section="${key}"]`);
  if (block) {
    block.classList.add('filled');
    const p = block.querySelector('p');
    if (p) {
      p.textContent = text;
    }
  }
}

// Reset Boardroom
function resetBoardroom() {
  if (state.simulationTimer) {
    clearTimeout(state.simulationTimer);
    state.simulationTimer = null;
  }
  state.isSimulating = false;
  filterFeed(null);
  setStage(1);

  const feed = document.getElementById('boardroom-feed');
  if (feed) feed.innerHTML = '';

  Object.keys(AGENT_REGISTRY).forEach(agentId => {
    setStatus(agentId, 'idle');
  });

  // Reset Charter blocks
  document.querySelectorAll('.charter-section-block').forEach(block => {
    block.classList.remove('filled');
    const defaultText = block.getAttribute('data-default') || 'Pending deliberation...';
    const p = block.querySelector('p');
    if (p) p.textContent = defaultText;
  });
}

// ── AI Engine Integration (Groq Multi-Agent Orchestration) ──────────────────────

const GROQ_SYSTEM_PROMPT = `You are the FoundrAI Autonomous Executive Suite Brain.
When given a founder's startup directive, deliberate and generate an in-depth, realistic, high-impact multi-agent executive deliberation and ratified startup charter.
You must return a valid JSON object matching this schema:
{
  "topic": "Venture Name: Subtitle",
  "steps": [
    {
      "agent": "ceo",
      "phase": 1,
      "time": "00:01",
      "title": "Executive Charter & Delegation Brief",
      "reasoning": "High-level strategic rationale and operational imperatives.",
      "content": "<p><strong>Executive Directive:</strong> Directive details...</p><p><strong>Operational Mandates:</strong></p><ul><li><strong>Research:</strong> Mandate...</li><li><strong>Engineering:</strong> Mandate...</li><li><strong>Marketing:</strong> Mandate...</li><li><strong>Finance:</strong> Mandate...</li><li><strong>Legal:</strong> Mandate...</li><li><strong>Designer:</strong> Mandate...</li></ul>",
      "charterKey": "vision",
      "charterSnippet": "1-2 sentence core executive thesis."
    },
    {
      "agent": "research",
      "phase": 2,
      "time": "00:03",
      "title": "Market Intelligence & Competitor Landscape",
      "reasoning": "Competitor benchmarking and TAM analysis heuristics.",
      "content": "<p>Benchmarking insights and beachhead customer profile...</p><table><thead><tr><th>Competitor</th><th>Price</th><th>Weakness</th><th>Advantage</th></tr></thead><tbody><tr><td>Comp A</td><td>$XX</td><td>Weakness</td><td>Our Moat</td></tr></tbody></table>",
      "charterKey": "market",
      "charterSnippet": "TAM sizing, beachhead customer segment, and core competitive moat."
    },
    {
      "agent": "engineer",
      "phase": 2,
      "time": "00:06",
      "title": "System Architecture & Technical Stack",
      "reasoning": "Latency, security, and scalability trade-offs.",
      "content": "<p><strong>Recommended Core Architecture:</strong></p><ul><li>Architecture & cloud infra specs</li><li>Data pipeline & model serving</li><li>Security & key APIs</li></ul>",
      "charterKey": "architecture",
      "charterSnippet": "Core tech stack, data pipeline, and system infrastructure."
    },
    {
      "agent": "designer",
      "phase": 2,
      "time": "00:09",
      "title": "Design System & UI/UX Interaction Blueprint",
      "reasoning": "User ergonomics, cognitive load, and accessibility heuristics.",
      "content": "<p><strong>Visual Metaphor & Palette:</strong></p><ul><li>Color tokens and contrast ratios</li><li>Typography pairings</li><li>Core interaction flow</li></ul>",
      "charterKey": "design",
      "charterSnippet": "Visual design tokens, typography, and interface ergonomics."
    },
    {
      "agent": "marketing",
      "phase": 2,
      "time": "00:12",
      "title": "Go-To-Market & Growth Architecture",
      "reasoning": "Organic distribution loops and CAC efficiency modeling.",
      "content": "<p><strong>Phase 1: Beachhead Launch:</strong></p><ul><li>Distribution channels and viral loops</li><li>Creator / partnership strategy</li><li>Waitlist & referral mechanics</li></ul>",
      "charterKey": "gtm",
      "charterSnippet": "Primary acquisition engine, organic loops, and launch roadmap."
    },
    {
      "agent": "finance",
      "phase": 3,
      "time": "00:15",
      "title": "Unit Economics & Financial Projections",
      "reasoning": "SaaS unit economic benchmarks and gross margin sensitivity.",
      "content": "<p><strong>Core Unit Economics Model:</strong></p><table><thead><tr><th>Metric</th><th>Target</th></tr></thead><tbody><tr><td>ARPU</td><td>$XX/mo</td></tr><tr><td>Target CAC</td><td>$XX</td></tr><tr><td>Estimated LTV</td><td>$XX</td></tr><tr><td>LTV:CAC</td><td>5.X</td></tr></tbody></table><p><strong>Break-Even Target:</strong> X subscribers / contracts required.</p>",
      "disclaimer": "Financial estimates and projections are generated for strategic planning purposes only and do not constitute certified financial or investment advice.",
      "charterKey": "economics",
      "charterSnippet": "Pricing model, target CAC/LTV ratio, and break-even subscriber threshold."
    },
    {
      "agent": "legal",
      "phase": 3,
      "time": "00:18",
      "title": "Regulatory, Privacy & IP Safeguards",
      "reasoning": "Statutory boundaries, data privacy regimes, and liability mitigation.",
      "content": "<p><strong>Compliance Frameworks:</strong></p><ul><li>Regulatory boundaries & safe harbors</li><li>Data privacy (GDPR / CCPA) protocols</li><li>Intellectual property protection</li></ul>",
      "disclaimer": "Legal agent outputs provide generalized informational frameworks only and do not constitute formal legal counsel.",
      "charterKey": "compliance",
      "charterSnippet": "Regulatory posture, privacy safe-harbors, and IP protection terms."
    },
    {
      "agent": "ceo",
      "phase": 4,
      "time": "00:21",
      "title": "Final Synthesis & Master Charter Ratification",
      "reasoning": "Harmonizing all 6 domain outputs into unified actionable master charter.",
      "content": "<p><strong>Executive Summary & Synthesis:</strong> All operational directives have been verified across research, engineering, design, marketing, finance, and compliance.</p><p>The <strong>Master Startup Charter</strong> is now ratified and ready for founder execution.</p>",
      "charterKey": "vision",
      "charterSnippet": "Ratified master startup charter synthesized across all 6 departments."
    }
  ]
}`;

/**
 * Robust JSON Extractor from LLM output.
 * Strips markdown code blocks (```json ... ```) or leading/trailing commentary.
 */
function extractJSONFromText(text) {
  if (!text) return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(cleaned);
}

/**
 * Call Groq AI API with structured multi-agent executive prompt.
 * Falls back to secondary model if primary model experiences latency or rate limits.
 */
async function callGroqAI(userPrompt) {
  if (!GROQ_CONFIG.apiKey) {
    throw new Error('Groq API Key is not configured.');
  }

  async function attemptRequest(modelName) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout

    try {
      const response = await fetch(GROQ_CONFIG.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${GROQ_CONFIG.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: GROQ_SYSTEM_PROMPT },
            { role: 'user', content: `Founder Directive: ${userPrompt}` }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.6
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const rawContent = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!rawContent) {
        throw new Error('Empty content payload.');
      }

      return extractJSONFromText(rawContent);
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  // Attempt primary model first
  try {
    return await attemptRequest(GROQ_CONFIG.model);
  } catch (primaryErr) {
    console.warn(`Primary model (${GROQ_CONFIG.model}) failed, trying fallback (${GROQ_CONFIG.fallbackModel}):`, primaryErr);
    if (GROQ_CONFIG.fallbackModel && GROQ_CONFIG.fallbackModel !== GROQ_CONFIG.model) {
      return await attemptRequest(GROQ_CONFIG.fallbackModel);
    }
    throw primaryErr;
  }
}

// ── Multi-Agent Playback & Simulation Engine ────────────────────────────────────

async function runSimulation(promptText, presetKey = 'fitness') {
  resetBoardroom();
  state.isSimulating = true;
  switchView('boardroom');

  const preset = PRESETS[presetKey] || PRESETS.fitness;
  const initialPrompt = promptText || preset.prompt;
  const topicTitle = document.getElementById('boardroom-topic-title');
  if (topicTitle) {
    topicTitle.textContent = preset.topic || initialPrompt;
  }

  // Auto-create chat session in DB if authenticated
  if (Auth.isLoggedIn && !ChatAPI.currentChatId) {
    await ChatAPI.create(preset.topic || initialPrompt);
  }

  // 1. Post Founder Directive to Feed
  addMessage('user', 'Founding Directive', `<p>${initialPrompt}</p>`, {
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });

  setStage(1);
  setStatus('ceo', 'active');

  let steps = null;
  let ventureTopic = preset.topic || initialPrompt;

  // 2. Fetch Multi-Agent Intelligence from Groq AI (if API key present)
  if (GROQ_CONFIG.apiKey) {
    // Show active thinking note in boardroom feed
    const thinkingNoteId = `thinking-${Date.now()}`;
    const feed = document.getElementById('boardroom-feed');
    let thinkingEl = null;
    if (feed) {
      thinkingEl = document.createElement('div');
      thinkingEl.id = thinkingNoteId;
      thinkingEl.className = 'meeting-note';
      thinkingEl.innerHTML = `
        <div class="note-header">
          <div class="note-agent-meta">
            <span class="note-agent-badge" style="background:var(--agent-ceo);color:#fff;">CEO Agent</span>
            <span class="roster-role-subtitle">Orchestration & Executive Brief</span>
          </div>
          <div class="note-time">In Deliberation</div>
        </div>
        <div class="note-body" style="color:var(--ink-secondary);">
          <em>⚡ Briefing Research, Engineering, Design, Marketing, Finance & Legal executive agents... Formulating startup charter.</em>
        </div>
      `;
      feed.appendChild(thinkingEl);
      feed.scrollTop = feed.scrollHeight;
    }

    const agentIds = Object.keys(AGENT_REGISTRY);
    let tick = 0;
    const loadingInterval = setInterval(() => {
      tick++;
      const currentIdx = tick % agentIds.length;
      setStatus(agentIds[currentIdx], 'active');
      if (tick > 1) {
        setStatus(agentIds[(tick - 1) % agentIds.length], 'idle');
      }
    }, 450);

    try {
      const aiResult = await callGroqAI(initialPrompt);
      clearInterval(loadingInterval);
      if (thinkingEl && thinkingEl.parentNode) {
        thinkingEl.parentNode.removeChild(thinkingEl);
      }
      agentIds.forEach(id => setStatus(id, 'idle'));

      if (aiResult.topic) {
        ventureTopic = aiResult.topic;
        if (topicTitle) topicTitle.textContent = ventureTopic;
      }

      if (Array.isArray(aiResult.steps) && aiResult.steps.length > 0) {
        steps = aiResult.steps;
      }
    } catch (err) {
      clearInterval(loadingInterval);
      if (thinkingEl && thinkingEl.parentNode) {
        thinkingEl.parentNode.removeChild(thinkingEl);
      }
      console.warn('Groq AI API error, falling back to preset steps:', err);
      steps = preset.steps || PRESETS.fitness.steps;
    }
  } else {
    steps = preset.steps || PRESETS.fitness.steps;
  }

  if (!steps || steps.length === 0) {
    steps = PRESETS.fitness.steps;
  }

  // 3. Play through generated steps with realistic executive deliberation rhythm
  let currentStepIdx = 0;

  function executeNextStep() {
    if (currentStepIdx >= steps.length) {
      state.isSimulating = false;
      // Auto-save completed deliberation and charter to Supabase
      saveCharterToSupabase(ventureTopic, initialPrompt, steps, state.charterData);
      return;
    }

    const step = steps[currentStepIdx];

    // Update progress bar
    if (step.phase) {
      setStage(step.phase);
    }

    // Previous agent status to done
    if (currentStepIdx > 0) {
      const prevStep = steps[currentStepIdx - 1];
      if (prevStep.agent !== step.agent) {
        setStatus(prevStep.agent, 'done');
      }
    }

    // Current agent active
    setStatus(step.agent, 'active');

    // Add structured deliberation message to feed
    addMessage(step.agent, step.title, step.content, {
      time: step.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      disclaimer: step.disclaimer,
      reasoning: step.reasoning
    });

    // Update live charter summary panel
    if (step.charterKey && step.charterSnippet) {
      updateCharterSnippet(step.charterKey, step.charterSnippet);
    }

    currentStepIdx++;

    if (currentStepIdx < steps.length) {
      state.simulationTimer = setTimeout(executeNextStep, 950);
    } else {
      setTimeout(() => {
        setStatus(step.agent, 'done');
        setStage(4);
        state.isSimulating = false;
        // Auto-save completed deliberation and charter to Supabase
        saveCharterToSupabase(ventureTopic, initialPrompt, steps, state.charterData);
      }, 600);
    }
  }

  state.simulationTimer = setTimeout(executeNextStep, 500);
}



// Initialization & Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  // 1. View Navigation
  document.querySelectorAll('[data-view-target]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const target = el.getAttribute('data-view-target');
      switchView(target);
    });
  });

  // Floating Demo Buttons
  document.querySelectorAll('.demo-view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.getAttribute('data-view');
      switchView(target);
    });
  });

  // 2. Hero Prompt Submission (Workflow Step 1 -> Step 2)
  const heroForm = document.getElementById('hero-prompt-form');
  const heroInput = document.getElementById('hero-prompt-input');
  const loginBanner = document.getElementById('login-directive-banner');
  const loginDirectiveText = document.getElementById('login-directive-text');

  function queueDirectiveAndGoToLogin(promptText, presetKey = 'fitness') {
    if (Auth.isLoggedIn) {
      runSimulation(promptText, presetKey);
      return;
    }

    state.pendingPrompt = promptText;
    state.pendingPreset = presetKey;

    if (loginBanner && loginDirectiveText) {
      if (promptText) {
        loginDirectiveText.textContent = `"${promptText}"`;
        loginBanner.classList.add('visible');
      } else {
        loginBanner.classList.remove('visible');
      }
    }
    switchView('login');
  }

  if (heroForm && heroInput) {
    heroForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = heroInput.value.trim() || 'I want to build an AI fitness companion.';
      queueDirectiveAndGoToLogin(text, 'fitness');
    });
  }

  // Quick Tags on Landing Page (Workflow Step 1 -> Step 2)
  document.querySelectorAll('.quick-tag').forEach(tag => {
    tag.addEventListener('click', () => {
      const presetKey = tag.getAttribute('data-preset');
      const preset = PRESETS[presetKey];
      if (preset) {
        if (heroInput) heroInput.value = preset.prompt;
        queueDirectiveAndGoToLogin(preset.prompt, presetKey);
      }
    });
  });

  // 3. Login Submission / Bypass (Workflow Step 2 -> Step 3)
  function completeAuthAndEnterBoardroom() {
    switchView('boardroom');
    if (state.pendingPrompt) {
      const promptToRun = state.pendingPrompt;
      const presetToRun = state.pendingPreset || 'fitness';
      state.pendingPrompt = '';
      runSimulation(promptToRun, presetToRun);
    }
  }

  const loginForm = document.getElementById('mock-login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      completeAuthAndEnterBoardroom();
    });
  }

  const loginBypassBtn = document.getElementById('btn-login-bypass');
  if (loginBypassBtn) {
    loginBypassBtn.addEventListener('click', () => {
      completeAuthAndEnterBoardroom();
    });
  }

  // Header Nav Links
  document.querySelectorAll('[data-view-target="login"]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!state.pendingPrompt && loginBanner) {
        loginBanner.classList.remove('visible');
      }
    });
  });

  // 4. Boardroom Input Submission
  const boardroomForm = document.getElementById('boardroom-form');
  const boardroomInput = document.getElementById('boardroom-input');
  if (boardroomForm && boardroomInput) {
    boardroomForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = boardroomInput.value.trim();
      if (!text) return;
      boardroomInput.value = '';
      runSimulation(text, 'fitness');
    });
  }

  // Mobile Boardroom Navigation Tabs
  document.querySelectorAll('.boardroom-mobile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.getAttribute('data-boardroom-tab');
      switchBoardroomMobileTab(tabName);
    });
  });

  // Secondary Boardroom Actions
  const resetBtn = document.getElementById('btn-reset-boardroom');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetBoardroom();
    });
  }

  const exportBtn = document.getElementById('btn-export-charter');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      alert('FounderAI Startup Charter exported to markdown file: /PulseAI_Master_Charter.md');
    });
  }

  // Sidebar Agent click to filter
  document.querySelectorAll('.sidebar-agent-item').forEach(item => {
    item.addEventListener('click', () => {
      const agentId = item.getAttribute('data-agent');
      if (state.activeFilter === agentId) {
        filterFeed(null); // toggle off
      } else {
        filterFeed(agentId);
      }
    });
  });

  // Clear sidebar filter
  const clearFilterBtn = document.getElementById('sidebar-clear-filter');
  if (clearFilterBtn) {
    clearFilterBtn.addEventListener('click', () => {
      filterFeed(null);
    });
  }

  // Charter block click -> scroll & pulse corresponding note in feed
  document.querySelectorAll('.charter-section-block').forEach(block => {
    block.addEventListener('click', () => {
      const agentId = block.getAttribute('data-agent');
      if (!agentId) return;

      if (window.innerWidth < 992) {
        switchBoardroomMobileTab('feed');
      }

      setTimeout(() => {
        const note = document.querySelector(`.meeting-note[data-agent="${agentId}"]`);
        if (note) {
          note.scrollIntoView({ behavior: 'smooth', block: 'center' });
          note.classList.add('highlight-pulse');
          setTimeout(() => { note.classList.remove('highlight-pulse'); }, 1500);
        }
      }, 50);
    });
  });

  // Sign out listeners
  const headerSignOutBtn = document.getElementById('btn-header-signout');
  if (headerSignOutBtn) {
    headerSignOutBtn.addEventListener('click', () => {
      signOut();
    });
  }

  const profileSignOutBtn = document.getElementById('btn-profile-signout');
  if (profileSignOutBtn) {
    profileSignOutBtn.addEventListener('click', () => {
      signOut();
    });
  }

  // Supabase UI Connect & Test Listeners
  const supabaseUrlInput = document.getElementById('input-supabase-url');
  const supabaseKeyInput = document.getElementById('input-supabase-key');
  const supabaseSaveBtn = document.getElementById('btn-save-supabase');
  const supabaseTestBtn = document.getElementById('btn-test-supabase');
  const supabaseStatusBadge = document.getElementById('supabase-status-badge');
  const supabaseFeedback = document.getElementById('supabase-feedback-text');

  // Load existing credentials from localStorage if present
  if (supabaseUrlInput && localStorage.getItem('foundrai_supabase_url')) {
    supabaseUrlInput.value = localStorage.getItem('foundrai_supabase_url');
  }
  if (supabaseKeyInput && localStorage.getItem('foundrai_supabase_key')) {
    supabaseKeyInput.value = localStorage.getItem('foundrai_supabase_key');
  }

  if (supabaseSaveBtn) {
    supabaseSaveBtn.addEventListener('click', () => {
      const url = (supabaseUrlInput ? supabaseUrlInput.value.trim() : '');
      const key = (supabaseKeyInput ? supabaseKeyInput.value.trim() : '');
      
      if (url && key) {
        localStorage.setItem('foundrai_supabase_url', url);
        localStorage.setItem('foundrai_supabase_key', key);
        supabaseClient = null; // force re-init
        const client = getSupabaseClient();
        if (supabaseStatusBadge) {
          supabaseStatusBadge.innerHTML = '<span class="status-dot done"></span> Connected';
        }
        if (supabaseFeedback) {
          supabaseFeedback.style.color = '#3E7C59';
          supabaseFeedback.textContent = '✓ Supabase credentials saved! Deliberations will be synchronized to "charters" table.';
        }
      } else {
        if (supabaseFeedback) {
          supabaseFeedback.style.color = '#c0392b';
          supabaseFeedback.textContent = 'Please enter both Supabase Project URL and Public Anon Key.';
        }
      }
    });
  }

  if (supabaseTestBtn) {
    supabaseTestBtn.addEventListener('click', async () => {
      const client = getSupabaseClient();
      if (!client) {
        if (supabaseFeedback) {
          supabaseFeedback.style.color = '#c0392b';
          supabaseFeedback.textContent = 'Enter and connect your Supabase credentials first.';
        }
        return;
      }
      if (supabaseFeedback) {
        supabaseFeedback.style.color = 'var(--ink-secondary)';
        supabaseFeedback.textContent = 'Testing connection to Supabase...';
      }
      try {
        const { data, error } = await client.from('charters').select('count', { count: 'exact', head: true });
        if (error) {
          if (supabaseFeedback) {
            supabaseFeedback.style.color = '#e67e22';
            supabaseFeedback.textContent = `Connected to project, but "charters" table was not found (${error.message}). Please create the "charters" table.`;
          }
        } else {
          if (supabaseFeedback) {
            supabaseFeedback.style.color = '#3E7C59';
            supabaseFeedback.textContent = '✓ Supabase connection verified! "charters" table is accessible.';
          }
        }
      } catch (err) {
        if (supabaseFeedback) {
          supabaseFeedback.style.color = '#c0392b';
          supabaseFeedback.textContent = `Connection test failed: ${err.message}`;
        }
      }
    });
  }

  // Initialize Auth listeners and load user state
  bootstrapAuth();

  // Default view
  switchView('landing');
});

// Expose on Window for Developer/Backend API consumption
window.FounderAI = {
  state,
  switchView,
  addMessage,
  setStatus,
  setStage,
  filterFeed,
  runSimulation,
  resetBoardroom,
  updateCharterSnippet
};

// Backwards compatibility alias
window.FoundrAI = window.FounderAI;
