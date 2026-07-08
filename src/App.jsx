import { useState, useRef, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase client ──────────────────────────────────────────────────────────
const SUPABASE_URL = "https://cxjhquprsmxkaqmznjfd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4amhxdXByc214a2FxbXpuamZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0NDMzMjMsImV4cCI6MjA5ODAxOTMyM30.sqRmsjZ1LXIC4F3_E2ZpPndzyo2KI4b94FtozJ3TCcE";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});

// ─── Amount scaling helper ────────────────────────────────────────────────────
function scaleAmount(amountStr, scale) {
  if (!amountStr || scale === 1) return amountStr;
  const s = amountStr.trim();
  // Fraction map for display
  const FRACS = { 0.125:"⅛", 0.25:"¼", 0.333:"⅓", 0.5:"½", 0.667:"⅔", 0.75:"¾" };
  const UNICODE_FRACS = { "¼":0.25, "½":0.5, "¾":0.75, "⅓":0.333333, "⅔":0.666667, "⅛":0.125, "⅜":0.375, "⅝":0.625, "⅞":0.875 };
  const fracCharClass = "¼½¾⅓⅔⅛⅜⅝⅞";
  function fmt(n) {
    if (n <= 0) return amountStr;
    const whole = Math.floor(n);
    const frac = n - whole;
    const fracKey = Object.keys(FRACS).find(k => Math.abs(frac - parseFloat(k)) < 0.04);
    if (fracKey && whole === 0) return FRACS[fracKey];
    if (fracKey && whole > 0) return `${whole} ${FRACS[fracKey]}`;
    if (frac < 0.05) return `${whole}`;
    return parseFloat(n.toFixed(2)).toString();
  }
  // Try to find a leading number -- unicode fractions first, then ascii fractions/decimals
  const mixedUnicodeRe = new RegExp(`^(\\d+)\\s*([${fracCharClass}])`);
  const unicodeRe = new RegExp(`^([${fracCharClass}])`);
  const mixedRe = /^(\d+)\s+(\d+)\/(\d+)/;
  const fracRe = /^(\d+)\/(\d+)/;
  const decRe = /^(\d+\.?\d*)/;
  let num = null, rest = "";
  let m;
  if ((m = s.match(mixedUnicodeRe))) { num = parseInt(m[1]) + UNICODE_FRACS[m[2]]; rest = s.slice(m[0].length); }
  else if ((m = s.match(unicodeRe))) { num = UNICODE_FRACS[m[1]]; rest = s.slice(m[0].length); }
  else if ((m = s.match(mixedRe))) { num = parseInt(m[1]) + parseInt(m[2])/parseInt(m[3]); rest = s.slice(m[0].length); }
  else if ((m = s.match(fracRe))) { num = parseInt(m[1])/parseInt(m[2]); rest = s.slice(m[0].length); }
  else if ((m = s.match(decRe))) { num = parseFloat(m[1]); rest = s.slice(m[0].length); }
  if (num === null) return amountStr;
  return fmt(num * scale) + rest;
}

// ─── Measurement conversion ───────────────────────────────────────────────────
function cvt(amount, s) {
  if (!amount || typeof amount !== "string") return amount;
  let r = amount;
  if (s.weight==="imperial") { r=r.replace(/(\d+\.?\d*)\s*kg\b/gi,(_,n)=>{const lb=parseFloat(n)*2.20462;return lb>=1?`${+lb.toFixed(1)} lb`:`${+(parseFloat(n)*35.274).toFixed(1)} oz`;}); r=r.replace(/(\d+\.?\d*)\s*g\b/gi,(_,n)=>{const oz=parseFloat(n)*0.035274;return oz<0.5?`${Math.round(parseFloat(n))}g`:`${+oz.toFixed(1)} oz`;}); }
  else if (s.weight==="metric") { r=r.replace(/(\d+\.?\d*)\s*lb\b/gi,(_,n)=>`${Math.round(parseFloat(n)*453.592)}g`); r=r.replace(/(\d+\.?\d*)\s*oz\b/gi,(_,n)=>`${Math.round(parseFloat(n)*28.3495)}g`); }
  if (s.volume==="imperial") { r=r.replace(/(\d+\.?\d*)\s*ml\b/gi,(_,n)=>{const ml=parseFloat(n);if(ml<=6)return"1 tsp";if(ml<=16)return"1 tbsp";return`${+(ml*0.033814).toFixed(1)} fl oz`;}); r=r.replace(/(\d+\.?\d*)\s*l\b/gi,(_,n)=>`${+(parseFloat(n)*4.22675).toFixed(1)} cups`); }
  else if (s.volume==="metric") { r=r.replace(/(\d+\.?\d*)\s*cups?\b/gi,(_,n)=>`${Math.round(parseFloat(n)*236.588)}ml`); r=r.replace(/(\d+\.?\d*)\s*tbsp\b/gi,(_,n)=>`${Math.round(parseFloat(n)*14.7868)}ml`); r=r.replace(/(\d+\.?\d*)\s*tsp\b/gi,(_,n)=>`${+(parseFloat(n)*4.92892).toFixed(1)}ml`); }
  if (s.temp==="f") r=r.replace(/(\d+)\s*[°]?C\b/g,(_,n)=>`${Math.round(parseInt(n)*9/5+32)}°F`);
  else if (s.temp==="c") r=r.replace(/(\d+)\s*[°]?F\b/g,(_,n)=>`${Math.round((parseInt(n)-32)*5/9)}°C`);
  return r;
}
function applyCvt(ing, steps, s) {
  if (s.weight==="original"&&s.volume==="original"&&s.temp==="original") return {ing,steps};
  return { ing:ing.map(i=>({...i,amount:cvt(i.amount,s)})), steps:steps.map(st=>cvt(st,s)) };
}

// ─── Equipment tag detection ──────────────────────────────────────────────────
const EQUIP_MAP = [
  { tag:"air-fryer",   words:["air fry","air-fry","airfry"] },
  { tag:"oven",        words:["oven","bake","roast","broil","preheat"] },
  { tag:"stovetop",    words:["skillet","frying pan","sauté pan","saute pan","stovetop","stove top","stove-top"] },
  { tag:"frying-pan",  words:["frying pan","skillet","pan-fry","pan fry","sear","sauté","saute"] },
  { tag:"pot",         words:["large pot","stockpot","dutch oven","boil","simmer in pot","soup pot"] },
  { tag:"blender",     words:["blender","blend until","blend the","high-speed blender","immersion blender"] },
  { tag:"food-processor", words:["food processor","pulse until","pulse in"] },
  { tag:"instant-pot", words:["instant pot","pressure cook","pressure cooker"] },
  { tag:"slow-cooker", words:["slow cooker","crockpot","crock pot","slow-cook"] },
  { tag:"grill",       words:["grill","barbecue","bbq","griddle"] },
  { tag:"microwave",   words:["microwave","microwave-safe"] },
  { tag:"stand-mixer", words:["stand mixer","hand mixer","electric mixer","beat with mixer"] },
];
function detectEquipTags(steps) {
  const text = steps.join(" ").toLowerCase();
  return EQUIP_MAP.filter(e => e.words.some(w => text.includes(w))).map(e => e.tag);
}

// ─── PDF text extraction (client-side, via PDF.js from CDN) ──────────────────
let _pdfjsLoadPromise = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (_pdfjsLoadPromise) return _pdfjsLoadPromise;
  _pdfjsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      resolve(window.pdfjsLib);
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return _pdfjsLoadPromise;
}
async function extractPdfText(file) {
  const pdfjsLib = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  const maxPages = Math.min(pdf.numPages, 15); // cap to avoid huge prompts
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join(" ") + "\n\n";
  }
  return text.trim();
}

// ─── Ingredient splitting (e.g. "salt and pepper" -> two separate entries) ────
const SPLIT_PAIRS = [
  ["salt and black pepper", "salt", "black pepper"],
  ["salt and white pepper", "salt", "white pepper"],
  ["salt and pepper",       "salt", "pepper"],
  ["pepper and salt",       "pepper", "salt"],
  ["oil and salt",          "oil", "salt"],
  ["sugar and salt",        "sugar", "salt"],
  ["herbs and spices",      "herbs", "spices"],
];
function splitIngredients(ingredients) {
  const result = [];
  (ingredients || []).forEach(ing => {
    const nameLow = (ing.name || "").toLowerCase().trim();
    const pair = SPLIT_PAIRS.find(([combo]) => nameLow.includes(combo));
    if (pair) {
      const [, a, b] = pair;
      result.push({ amount: ing.amount || "to taste", name: a });
      result.push({ amount: ing.amount || "to taste", name: b });
    } else {
      result.push(ing);
    }
  });
  return result;
}

// ─── Grocery list builder ─────────────────────────────────────────────────────
// Detects whether an amount string is numeric (has a leading number)
function isNumericAmount(amountStr) {
  if (!amountStr) return false;
  return /^[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(amountStr.trim());
}

// Parse a fraction/mixed/decimal string to a float, return null if not parseable
function parseAmountNum(s) {
  s = s.trim();
  const UNICODE_FRACS = { "\u00bc":0.25, "\u00bd":0.5, "\u00be":0.75, "\u2153":0.333333, "\u2154":0.666667, "\u215b":0.125, "\u215c":0.375, "\u215d":0.625, "\u215e":0.875 };
  const fracCharClass = "\u00bc\u00bd\u00be\u2153\u2154\u215b\u215c\u215d\u215e";
  // Mixed: whole number + space + unicode fraction, e.g. "1 \u00bc" or "1\u00bc"
  const mixedUnicodeRe = new RegExp(`^(\\d+)\\s*([${fracCharClass}])`);
  // Standalone unicode fraction, e.g. "\u00bc"
  const unicodeRe = new RegExp(`^([${fracCharClass}])`);
  // ASCII mixed fraction, e.g. "1 1/2"
  const mixedRe = /^(\d+)\s+(\d+)\/(\d+)/;
  // ASCII simple fraction, e.g. "1/2"
  const fracRe = /^(\d+)\/(\d+)/;
  // Plain decimal/integer, e.g. "2.5" or "400"
  const decRe = /^(\d+\.?\d*)/;
  let m;
  if ((m = s.match(mixedUnicodeRe))) return parseInt(m[1]) + UNICODE_FRACS[m[2]];
  if ((m = s.match(unicodeRe))) return UNICODE_FRACS[m[1]];
  if ((m = s.match(mixedRe))) return parseInt(m[1]) + parseInt(m[2])/parseInt(m[3]);
  if ((m = s.match(fracRe))) return parseInt(m[1])/parseInt(m[2]);
  if ((m = s.match(decRe))) return parseFloat(m[1]);
  return null;
}

// Extract the unit suffix from an amount string (e.g. "2 cups" → "cups", "400g" → "g")
function extractUnit(s) {
  s = s.trim();
  const m = s.match(/^[\d\s\/\.¼½¾⅓⅔⅛⅜⅝⅞]+(.*)$/);
  return m ? m[1].trim().toLowerCase() : "";
}

// Format a number back with fractions where nice
function fmtNum(n) {
  const FRACS = { 0.125:"⅛", 0.25:"¼", 0.333:"⅓", 0.5:"½", 0.667:"⅔", 0.75:"¾" };
  if (n <= 0) return "0";
  const whole = Math.floor(n);
  const frac = n - whole;
  const fracKey = Object.keys(FRACS).find(k => Math.abs(frac - parseFloat(k)) < 0.04);
  if (fracKey && whole === 0) return FRACS[fracKey];
  if (fracKey && whole > 0) return `${whole} ${FRACS[fracKey]}`;
  if (frac < 0.05) return `${whole}`;
  return parseFloat(n.toFixed(2)).toString();
}

function buildGroceryList(mealPlan, recipes) {
  // map: ingredientKey → { name, sources: [{recipeTitle, rawAmount, scale}] }
  const map = {};
  Object.values(mealPlan).forEach(dayMeals => {
    (dayMeals||[]).forEach(({ recipeId, servings }) => {
      const recipe = recipes.find(r => r.id === recipeId);
      if (!recipe) return;
      const scale = servings / (recipe.servings || 1);
      recipe.ingredients.forEach(ing => {
        const key = ing.name.toLowerCase().trim();
        if (!map[key]) map[key] = { name: ing.name, sources: [] };
        map[key].sources.push({ recipeTitle: recipe.title, rawAmount: ing.amount, scale });
      });
    });
  });

  return Object.values(map).sort((a,b) => a.name.localeCompare(b.name)).map(item => {
    const sources = item.sources;
    // Determine if ALL sources have numeric amounts with the same unit → aggregate
    const allNumeric = sources.every(s => isNumericAmount(s.rawAmount));
    const units = sources.map(s => extractUnit(s.rawAmount));
    const allSameUnit = allNumeric && units.every(u => u === units[0]);

    let displayAmount = null;
    let subLines = []; // per-recipe breakdown shown below

    if (allSameUnit) {
      // Sum scaled amounts
      const total = sources.reduce((acc, s) => {
        const num = parseAmountNum(s.rawAmount);
        return acc + (num !== null ? num * s.scale : 0);
      }, 0);
      const unit = units[0];
      displayAmount = fmtNum(total) + (unit ? " " + unit : "");
      // Build sub-lines only if multiple distinct recipes contributed
      const recipeGroups = {};
      sources.forEach(s => {
        const num = parseAmountNum(s.rawAmount);
        const scaled = num !== null ? num * s.scale : 0;
        if (!recipeGroups[s.recipeTitle]) recipeGroups[s.recipeTitle] = 0;
        recipeGroups[s.recipeTitle] += scaled;
      });
      if (Object.keys(recipeGroups).length > 1) {
        subLines = Object.entries(recipeGroups).map(([title, amt]) => `${fmtNum(amt)}${unit ? " "+unit : ""} (${title})`);
      } else {
        // Single recipe, just show the recipe title
        subLines = [`${displayAmount} — ${Object.keys(recipeGroups)[0]}`];
      }
    } else {
      // Non-numeric or mixed units (e.g. "handful", "to taste") -- can't sum these,
      // but DO consolidate repeated entries from the same recipe+amount into a count.
      const groups = {}; // key: "amount||recipeTitle" -> { amount, recipeTitle, count }
      sources.forEach(s => {
        const numeric = isNumericAmount(s.rawAmount);
        const scaled = numeric ? scaleAmount(s.rawAmount, s.scale) : s.rawAmount;
        const key = scaled + "||" + s.recipeTitle;
        if (!groups[key]) groups[key] = { amount: scaled, recipeTitle: s.recipeTitle, count: 0 };
        groups[key].count += 1;
      });
      subLines = Object.values(groups).map(g =>
        `${g.amount} \u2014 ${g.recipeTitle}${g.count > 1 ? ` \u00d7${g.count}` : ""}`
      );
      // For the headline display amount, show unique amount values (deduped)
      displayAmount = [...new Set(Object.values(groups).map(g => g.amount))].join(", ");
    }

    return { name: item.name, displayAmount, subLines, isNonNumeric: !allSameUnit };
  });
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_LABELS_SUN = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAY_LABELS_MON = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

function getMonthDays(year, month, startMonday) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month+1, 0);
  const startDow = firstDay.getDay(); // 0=Sun
  const offset = startMonday ? (startDow === 0 ? 6 : startDow - 1) : startDow;
  const cells = [];
  for (let i = 0; i < offset; i++) {
    const d = new Date(year, month, 1 - (offset - i));
    cells.push({ date: d, thisMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push({ date: new Date(year, month, d), thisMonth: true });
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length-1].date;
    const next = new Date(last); next.setDate(last.getDate()+1);
    cells.push({ date: next, thisMonth: false });
  }
  return cells;
}

// ─── Auth & data helpers (Supabase-backed) ────────────────────────────────────
function generateCode() { return String(Math.floor(100000 + Math.random() * 900000)); }
function generatePassword() {
  // Random throwaway password the user never sees or types -- gated entirely by the emailed code
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + "Aa1!";
}

// ─── EmailJS config (sends the verification code, runs entirely client-side) ──
const EMAILJS_SERVICE_ID = "service_lv9leie";
const EMAILJS_TEMPLATE_ID = "template_h4v09jw";
const EMAILJS_PUBLIC_KEY = "Azaqm6NZVZ1NwOklh";

async function sendCodeEmail(email, name, code) {
  const resp = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: { to_email: email, to_name: name || email, code },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error("EmailJS error:", errText);
    throw new Error("Couldn't send the verification email. Please try again.");
  }
}

// ─── Request a code for sign-up ────────────────────────────────────────────────
// Creates (or refreshes) an auth_bridge row with a fresh password + code,
// but does NOT create the Supabase Auth user yet -- that happens on verify.
async function sbRequestSignupCode(email, name) {
  const code = generateCode();
  const password = generatePassword();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await supabase.from("auth_bridge").upsert({
    email, current_password: password, pending_code: code,
    pending_code_expires_at: expiresAt, pending_signup_name: name, is_new_signup: true,
  });
  if (error) throw error;

  await sendCodeEmail(email, name, code);
}

// ─── Request a code for login (existing account) ───────────────────────────────
// Reuses the SAME stored password (so Supabase Auth still recognizes it),
// just issues a fresh short-lived code.
async function sbRequestLoginCode(email) {
  const { data: bridge, error: fetchErr } = await supabase.from("auth_bridge").select("*").eq("email", email).maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!bridge) throw new Error("No account found for this email. Sign up first.");

  const code = generateCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  const { error } = await supabase.from("auth_bridge").update({
    pending_code: code, pending_code_expires_at: expiresAt,
  }).eq("email", email);
  if (error) throw error;

  await sendCodeEmail(email, null, code);
}

// ─── Verify the code and complete sign-up or log-in ────────────────────────────
async function sbVerifyCode(email, codeInput) {
  const { data: bridge, error: fetchErr } = await supabase.from("auth_bridge").select("*").eq("email", email).maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!bridge || !bridge.pending_code) throw new Error("No pending verification found. Please request a new code.");
  if (new Date(bridge.pending_code_expires_at) < new Date()) throw new Error("Code expired. Please request a new one.");
  if (bridge.pending_code !== codeInput.trim()) throw new Error("Incorrect code. Please check and try again.");

  if (bridge.is_new_signup) {
    // First-time verification: actually create the Supabase Auth user now
    const { data, error } = await supabase.auth.signUp({
      email, password: bridge.current_password,
      options: { data: { name: bridge.pending_signup_name } },
    });
    if (error) throw error;
    await supabase.from("auth_bridge").update({
      pending_code: null, pending_code_expires_at: null, is_new_signup: false,
    }).eq("email", email);
    return data.user;
  } else {
    // Returning user: sign in with the same stored password
    const { data, error } = await supabase.auth.signInWithPassword({
      email, password: bridge.current_password,
    });
    if (error) throw error;
    await supabase.from("auth_bridge").update({
      pending_code: null, pending_code_expires_at: null,
    }).eq("email", email);
    return data.user;
  }
}

async function sbGetSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
async function sbSignOut() {
  await supabase.auth.signOut();
}
// Ensure a row exists in our `users` table (id matches auth.uid())
async function sbEnsureUserRow(authUser) {
  const name = authUser.user_metadata?.name || authUser.email.split("@")[0];
  const { data: existing, error: selectErr } = await supabase.from("users").select("*").eq("id", authUser.id).maybeSingle();
  if (selectErr) { console.error("sbEnsureUserRow select error:", selectErr); throw selectErr; }
  if (!existing) {
    const { error: insertErr } = await supabase.from("users").insert({ id: authUser.id, email: authUser.email, name });
    if (insertErr) { console.error("sbEnsureUserRow insert error:", insertErr); throw insertErr; }
    // Seed sample recipes for new users -- surface any failures instead of swallowing them
    for (const r of SAMPLE_RECIPES) {
      const { error: seedErr } = await supabase.from("recipes").insert({
        user_id: authUser.id, title: r.title, description: r.description,
        prep_time: r.prepTime, cook_time: r.cookTime, servings: r.servings,
        tags: r.tags, notes: r.notes||"", image: r.image||null,
        ingredients: r.ingredients, steps: r.steps,
      });
      if (seedErr) console.error("Seed recipe failed:", r.title, seedErr);
    }
    return { id: authUser.id, email: authUser.email, name };
  }
  return existing;
}

// ─── Recipes ──────────────────────────────────────────────────────────────────
function dbRowToRecipe(row) {
  return {
    id: row.id, title: row.title, description: row.description||"",
    prepTime: row.prep_time||"", cookTime: row.cook_time||"", servings: row.servings||4,
    tags: row.tags||[], notes: row.notes||"", image: row.image||null,
    ingredients: row.ingredients||[], steps: row.steps||[],
    createdAt: new Date(row.created_at),
  };
}
async function sbLoadRecipes(userId) {
  const { data, error } = await supabase.from("recipes").select("*")
    .eq("user_id", userId).is("deleted_at", null).order("created_at", { ascending:false });
  if (error) { console.error(error); return []; }
  return (data||[]).map(dbRowToRecipe);
}
async function sbLoadTrash(userId) {
  const { data, error } = await supabase.from("recipes").select("*")
    .eq("user_id", userId).not("deleted_at", "is", null).order("deleted_at", { ascending:false });
  if (error) { console.error(error); return []; }
  return (data||[]).map(r => ({...dbRowToRecipe(r), deletedAt: new Date(r.deleted_at)}));
}
async function sbInsertRecipe(userId, r) {
  const { data, error } = await supabase.from("recipes").insert({
    user_id: userId, title: r.title, description: r.description||"",
    prep_time: r.prepTime||"", cook_time: r.cookTime||"", servings: r.servings||4,
    tags: r.tags||[], notes: r.notes||"", image: r.image||null,
    ingredients: r.ingredients||[], steps: r.steps||[],
  }).select().single();
  if (error) { console.error("sbInsertRecipe error:", error); throw error; }
  return dbRowToRecipe(data);
}
async function sbUpdateRecipe(r) {
  const { error } = await supabase.from("recipes").update({
    title: r.title, description: r.description||"", prep_time: r.prepTime||"",
    cook_time: r.cookTime||"", servings: r.servings||4, tags: r.tags||[],
    notes: r.notes||"", image: r.image||null, ingredients: r.ingredients||[], steps: r.steps||[],
  }).eq("id", r.id);
  if (error) console.error(error);
}
async function sbSoftDeleteRecipe(id) {
  const { error } = await supabase.from("recipes").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) console.error(error);
}
async function sbRestoreRecipe(id) {
  const { error } = await supabase.from("recipes").update({ deleted_at: null }).eq("id", id);
  if (error) console.error(error);
}

// ─── Meal plan ────────────────────────────────────────────────────────────────
// Reconstructs the in-memory shape { [dateKey]: [{recipeId, servings, _entryId}] } from rows
async function sbLoadMealPlan(userId) {
  const { data, error } = await supabase.from("meal_plan_entries").select("*").eq("user_id", userId);
  if (error) { console.error(error); return {}; }
  const plan = {};
  (data||[]).forEach(row => {
    if (!plan[row.date_key]) plan[row.date_key] = [];
    plan[row.date_key].push({ recipeId: row.recipe_id, servings: row.servings, _entryId: row.id });
  });
  return plan;
}
async function sbAddMealEntry(userId, dateKey, recipeId, servings) {
  const { data, error } = await supabase.from("meal_plan_entries").insert({
    user_id: userId, date_key: dateKey, recipe_id: recipeId, servings,
  }).select().single();
  if (error) { console.error(error); return null; }
  return data.id;
}
async function sbUpdateMealEntry(entryId, servings) {
  const { error } = await supabase.from("meal_plan_entries").update({ servings }).eq("id", entryId);
  if (error) console.error(error);
}
async function sbDeleteMealEntry(entryId) {
  const { error } = await supabase.from("meal_plan_entries").delete().eq("id", entryId);
  if (error) console.error(error);
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function sbLoadSettings(userId) {
  const { data, error } = await supabase.from("user_settings").select("*").eq("user_id", userId).maybeSingle();
  if (error || !data) return null;
  return { weight:data.weight, volume:data.volume, temp:data.temp, weekStart:data.week_start, dark:data.dark };
}
async function sbSaveSettings(userId, s) {
  const { error } = await supabase.from("user_settings").upsert({
    user_id: userId, weight:s.weight, volume:s.volume, temp:s.temp, week_start:s.weekStart, dark:s.dark,
  });
  if (error) console.error(error);
}

// ─── Shared recipe inbox ──────────────────────────────────────────────────────
async function sbLoadInbox(email) {
  const { data, error } = await supabase.from("shared_recipes").select("*")
    .eq("recipient_email", email).order("sent_at", { ascending:false });
  if (error) { console.error(error); return []; }
  return (data||[]).map(row => ({
    id: row.id, recipe: row.recipe, fromName: row.from_name, fromEmail: row.from_email, sentAt: row.sent_at,
  }));
}
async function sbShareRecipe(recipientEmail, recipe, fromName, fromEmail) {
  const { error } = await supabase.from("shared_recipes").insert({
    recipient_email: recipientEmail, recipe, from_name: fromName, from_email: fromEmail,
  });
  if (error) throw error;
}
async function sbDismissInboxItem(id) {
  const { error } = await supabase.from("shared_recipes").delete().eq("id", id);
  if (error) console.error(error);
}
async function sbCheckUserExists(email) {
  const { data } = await supabase.from("users").select("id").eq("email", email).maybeSingle();
  return !!data;
}

function encodeShareLink(recipe) {
  // Strip large image data-urls before encoding to keep URL manageable
  const r = {...recipe, image: recipe.image?.startsWith("http") ? recipe.image : null};
  try {
    const json = JSON.stringify(r);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    return `${window.location.href.split("#")[0]}#share=${b64}`;
  } catch { return null; }
}
function decodeShareLink(hash) {
  try {
    const b64 = hash.replace(/^#?share=/, "");
    const json = decodeURIComponent(escape(atob(b64)));
    const r = JSON.parse(json);
    if (!r.title || !r.ingredients) return null;
    return {...r, id: Date.now().toString(), createdAt: new Date(), sharedVia:"link"};
  } catch { return null; }
}
function recipeToText(recipe) {
  const LF = "\n";
  const lines = [];
  lines.push("# " + recipe.title);
  if (recipe.description) lines.push(recipe.description);
  lines.push("Prep: " + (recipe.prepTime||"-") + "  |  Cook: " + (recipe.cookTime||"-") + "  |  Serves: " + (recipe.servings||"-"));
  if (recipe.tags && recipe.tags.length) lines.push("Tags: " + recipe.tags.join(", "));
  lines.push(LF + "## Ingredients");
  recipe.ingredients.forEach(function(ing) { lines.push("- " + ing.amount + " " + ing.name); });
  lines.push(LF + "## Instructions");
  recipe.steps.forEach(function(s, i) { lines.push((i + 1) + ". " + s); });
  if (recipe.notes) { lines.push(LF + "## Notes"); lines.push(recipe.notes); }
  return lines.join(LF);
}
const SAMPLE_RECIPES = [
  { id:"s1", title:"Lemon Pasta", description:"A bright, zesty pasta with lemon zest and parmesan.", prepTime:"10 min", cookTime:"20 min", servings:4, tags:["pasta","italian","vegetarian","quick","stovetop","pot"], notes:"", image:null, createdAt:new Date("2024-01-15"), ingredients:[{amount:"400g",name:"spaghetti"},{amount:"2",name:"lemons (zest and juice)"},{amount:"100g",name:"parmesan, grated"},{amount:"3 tbsp",name:"olive oil"},{amount:"3 cloves",name:"garlic"},{amount:"to taste",name:"salt and black pepper"},{amount:"handful",name:"fresh parsley"}], steps:["Bring a large pot of salted water to a boil. Cook spaghetti until al dente.","Heat olive oil in a skillet over medium heat. Add minced garlic, saute 1 minute.","Add lemon zest and juice, stir well.","Drain pasta, reserving 1 cup pasta water. Add pasta to pan.","Add parmesan and toss, adding pasta water as needed.","Season and top with parsley."] },
  { id:"s2", title:"Lemon Blueberry Muffins", description:"Fluffy muffins bursting with blueberries and fresh lemon.", prepTime:"15 min", cookTime:"22 min", servings:12, tags:["baking","breakfast","muffins","sweet","oven"], notes:"Best eaten warm. Freeze well for up to 3 months.", image:null, createdAt:new Date("2024-02-03"), ingredients:[{amount:"2 cups",name:"all-purpose flour"},{amount:"3/4 cup",name:"sugar"},{amount:"2 tsp",name:"baking powder"},{amount:"1/2 tsp",name:"salt"},{amount:"1",name:"lemon, zested"},{amount:"2 tbsp",name:"lemon juice"},{amount:"1/3 cup",name:"butter, melted"},{amount:"1 cup",name:"milk"},{amount:"2",name:"eggs"},{amount:"1.5 cups",name:"fresh blueberries"}], steps:["Preheat oven to 375F (190C). Line a 12-cup muffin tin.","Whisk together flour, sugar, baking powder, salt, and lemon zest.","Mix butter, milk, eggs, and lemon juice.","Fold wet into dry until just combined.","Gently fold in blueberries.","Fill muffin cups 3/4 full. Bake 20-22 minutes until golden."] },
  { id:"s3", title:"Chicken Tikka Masala", description:"Rich, creamy tomato curry with tender chicken.", prepTime:"20 min", cookTime:"40 min", servings:4, tags:["indian","curry","chicken","spicy","stovetop","frying-pan"], notes:"Marinating overnight makes a big difference.", image:null, createdAt:new Date("2024-02-20"), ingredients:[{amount:"700g",name:"chicken breast, cubed"},{amount:"1 cup",name:"plain yogurt"},{amount:"2 tsp",name:"garam masala"},{amount:"1 tsp",name:"turmeric"},{amount:"1 tsp",name:"cumin"},{amount:"1",name:"onion, diced"},{amount:"4 cloves",name:"garlic"},{amount:"1 tbsp",name:"fresh ginger, grated"},{amount:"400g",name:"crushed tomatoes"},{amount:"1 cup",name:"heavy cream"},{amount:"2 tbsp",name:"oil"},{amount:"to taste",name:"salt"}], steps:["Marinate chicken in yogurt, 1 tsp garam masala, turmeric, and salt for 30 min.","Broil or pan-sear chicken in a frying pan until charred, set aside.","Saute onion until golden. Add garlic and ginger, cook 2 min.","Add remaining spices, then tomatoes. Simmer 15 min.","Add cream and chicken, simmer 10 more minutes.","Serve over basmati rice with naan."] },
];

// ─── Theme tokens ─────────────────────────────────────────────────────────────
function getTheme(dark) {
  return dark ? {
    bg:"#11171A", surface:"#1A2226", paper:"#202A2E", border:"#34434A",
    terra:"#5FC9C2", terraBtn:"#157570", terraLight:"#1C3635", ink:"#EDF5F4", muted:"#A8BEBD",
    sage:"#B8D08A", sageLight:"#222B1C", white:"#1A2226", cream:"#11171A",
  } : {
    bg:"#F6FAFA", surface:"#FFFFFF", paper:"#E9F2F1", border:"#CFE3E1",
    terra:"#0E6B68", terraBtn:"#0E6B68", terraLight:"#D6ECEA", ink:"#1B2625", muted:"#5B7271",
    sage:"#56652E", sageLight:"#E7EBD8", white:"#FFFFFF", cream:"#F7FAF9",
  };
}
const serif = "'Source Serif 4', Georgia, serif";
const sans = "'Inter', system-ui, sans-serif";

// ─── CSS ──────────────────────────────────────────────────────────────────────
function makeCSS(T) { return `
@import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=Inter:wght@300;400;500;600&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
body{background:${T.bg};color:${T.ink};font-family:${sans}}
input,textarea,select{font-family:${sans};font-size:14px;padding:8px 12px;border:1px solid ${T.border};border-radius:6px;background:${T.surface};color:${T.ink};outline:none;transition:border-color .15s}
input:focus,textarea:focus,select:focus{border-color:${T.terra}}
textarea{resize:vertical;min-height:60px}
button{font-family:${sans};cursor:pointer;border:none;border-radius:6px;transition:all .15s}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:${T.border};border-radius:3px}
.tag{display:inline-block;font-size:11px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:20px;background:${T.sageLight};color:${T.sage}}
.tag.t2{background:${T.terraLight};color:${T.terra}}
.bp{background:${T.terraBtn};color:#fff;padding:9px 18px;font-size:14px;font-weight:500}
.bp:hover{filter:brightness(1.1)}.bp:disabled{opacity:.5;cursor:not-allowed}
.bg{background:transparent;color:${T.ink};padding:8px 14px;font-size:13px;border:1px solid ${T.border}}
.bg:hover{background:${T.paper}}
.card{background:${T.surface};border:1px solid ${T.border};border-radius:10px;overflow:hidden}
.ld{display:inline-block;width:5px;height:5px;border-radius:50%;background:${T.terra};animation:_pulse 1.2s ease-in-out infinite}
.ld:nth-child(2){animation-delay:.2s}.ld:nth-child(3){animation-delay:.4s}
@keyframes _pulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
@keyframes _fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.fi{animation:_fadeIn .25s ease forwards}
.srow{display:flex;align-items:center;justify-content:space-between;padding:11px 0;border-bottom:1px solid ${T.border}}
.srow:last-child{border-bottom:none}
.nav-btn{background:transparent;border:none;padding:8px 16px;font-size:14px;color:${T.muted};border-bottom:2px solid transparent;border-radius:0;font-weight:500}
.nav-btn.active{color:${T.terra};border-bottom-color:${T.terra}}
.nav-btn:hover{color:${T.terra};background:${T.terraLight}}
.icon-btn{background:none;border:none;padding:3px;color:${T.muted};font-size:15px;line-height:1}
.icon-btn:hover{color:${T.ink}}
`; }

function Dots() { return <span style={{display:"inline-flex",gap:3,alignItems:"center"}}><span className="ld"/><span className="ld"/><span className="ld"/></span>; }

// ─── Claude API ───────────────────────────────────────────────────────────────
const SYS = `Extract and standardize recipes. Return ONLY valid JSON, no markdown, no backticks:
{"title":"string","description":"1-2 sentences","prepTime":"X min","cookTime":"X min","servings":number,"tags":["tag"],"notes":"any recipe notes, tips, or source info","imageUrl":"full https url of the main recipe photo if found in the page content, else null","ingredients":[{"amount":"string","name":"string"}],"steps":["step"]}
Tags: 2-6 lowercase single words. Ingredient names lowercase. Use defaults for unknown fields. Put cook's notes/tips in the notes field. For imageUrl: look for og:image, twitter:image, or the largest food photo URL in the page content. Return null if none found.`;

async function callClaude(msgs, system) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ model:"claude-sonnet-4-20250514", max_tokens:2000, system:system||SYS, messages:msgs }),
  });
  const d = await res.json();
  if (d.error) {
    const m = d.error.message || "";
    if (d.error.type === "rate_limit_error" || m.includes("exceeded_limit")) {
      try {
        const j = m.startsWith("{") ? JSON.parse(m) : null;
        const resetsAt = j?.resetsAt || j?.windows?.["5h"]?.resets_at;
        const t = resetsAt ? new Date(resetsAt*1000).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) : "a few hours";
        throw new Error("Rate limit reached — resets at " + t + ". Try again then.");
      } catch(e2) { if (e2.message.startsWith("Rate limit")) throw e2; }
    }
    throw new Error(d.error.message || "API error");
  }
  return d.content?.map(b=>b.text||"").join("")||"";
}

// No CORS proxy needed — we pass URL/text directly to Claude which handles it
// Claude can reason about URLs and extract recipe content from pasted text equally well

// ─── Overlay wrapper (click-outside closes) ───────────────────────────────────
function Overlay({ onClose, children, zIndex=100 }) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex,display:"flex",alignItems:"flex-start",justifyContent:"center",padding:"20px 16px",overflowY:"auto"}}
      onMouseDown={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      {children}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH SCREEN — email verification code flow (no passwords stored)
// ═══════════════════════════════════════════════════════════════════════════════
function AuthScreen({ T, onLogin }) {
  const [mode, setMode] = useState("login"); // login | signup
  const [step, setStep] = useState("email"); // email | code
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [err, setErr] = useState("");
  const [info, setInfo] = useState("");

  async function requestCode() {
    setErr(""); setInfo("");
    const key = email.trim().toLowerCase();
    if (!key.includes("@")) { setErr("Enter a valid email address."); return; }
    setLoading(true);
    try {
      const exists = await sbCheckUserExists(key);
      if (mode === "login" && !exists) {
        setErr("No account found for this email. Sign up first."); setLoading(false); return;
      }
      if (mode === "signup") {
        if (!name.trim()) { setErr("Please enter your name."); setLoading(false); return; }
        if (exists) { setErr("An account already exists for this email. Log in instead."); setLoading(false); return; }
        await sbRequestSignupCode(key, name.trim());
      } else {
        await sbRequestLoginCode(key);
      }
      setStep("code");
      setInfo(`A 6-digit code was sent to ${key}. Check your inbox (and spam folder).`);
    } catch(e) {
      console.error("Send error:", e);
      setErr(e.message || "Couldn't send the email. Please try again.");
    }
    setLoading(false);
  }

  async function verifyCode() {
    setErr(""); setLoading(true);
    const key = email.trim().toLowerCase();
    try {
      const authUser = await sbVerifyCode(key, codeInput);
      const userRow = await sbEnsureUserRow(authUser);
      onLogin(userRow);
    } catch(e) {
      console.error("Verify error:", e);
      setErr(e.message || "Incorrect or expired code. Please check and try again.");
    }
    setLoading(false);
  }

  async function resend() {
    setResending(true); setErr("");
    const key = email.trim().toLowerCase();
    try {
      if (mode === "signup") await sbRequestSignupCode(key, name.trim());
      else await sbRequestLoginCode(key);
      setInfo(`A new code was sent to ${key}.`);
    } catch(e) {
      console.error(e);
      setErr(e.message || "Couldn't resend. Please try again.");
    }
    setResending(false);
  }

  return (
    <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div className="card fi" style={{width:"100%",maxWidth:400}}>
        <div style={{padding:"28px 28px 10px",textAlign:"center"}}>
          <h1 style={{fontFamily:serif,fontSize:28,marginBottom:4}}>
            <span style={{color:T.muted}}>my</span><span style={{color:T.terra}}>recipe</span><span style={{color:T.sage}}>cards</span>
          </h1>
          <p style={{fontSize:13,color:T.muted}}>Your personal recipe collection</p>
        </div>
        <div style={{padding:"16px 28px 28px",display:"flex",flexDirection:"column",gap:11}}>
          {step==="email"&&<>
            <div style={{display:"flex",gap:0,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden",marginBottom:2}}>
              {[["login","Log in"],["signup","Sign up"]].map(([m,l])=>(
                <button key={m} onClick={()=>{setMode(m);setErr("");}}
                  style={{flex:1,padding:"8px 0",fontSize:13,background:mode===m?T.terraBtn:"transparent",color:mode===m?"#fff":T.muted,border:"none",cursor:"pointer",fontFamily:sans,fontWeight:mode===m?500:400}}>
                  {l}
                </button>
              ))}
            </div>
            {mode==="signup"&&<input placeholder="Your name" value={name} onChange={e=>setName(e.target.value)} style={{width:"100%",background:T.surface,color:T.ink}}/>}
            <input placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)} style={{width:"100%",background:T.surface,color:T.ink}} type="email"
              onKeyDown={e=>e.key==="Enter"&&requestCode()}/>
            {err&&<p style={{fontSize:12,color:"#C0392B"}}>{err}</p>}
            <button className="bp" onClick={requestCode} disabled={loading} style={{width:"100%",marginTop:2}}>
              {loading?<Dots/>:(mode==="login"?"Send login code":"Create account")}
            </button>
          </>}
          {step==="code"&&<>
            <div style={{padding:"10px 14px",background:T.paper,borderRadius:8,fontSize:13,color:T.muted,lineHeight:1.5}}>
              {info}
            </div>
            <input placeholder="Enter 6-digit code" value={codeInput} onChange={e=>setCodeInput(e.target.value.replace(/\D/g,"").slice(0,6))}
              style={{width:"100%",background:T.surface,color:T.ink,fontSize:22,textAlign:"center",letterSpacing:"0.3em",fontFamily:serif}}
              onKeyDown={e=>e.key==="Enter"&&verifyCode()}/>
            {err&&<p style={{fontSize:12,color:"#C0392B"}}>{err}</p>}
            <button className="bp" onClick={verifyCode} disabled={loading} style={{width:"100%"}}>{loading?<Dots/>:"Verify & continue →"}</button>
            <button className="bg" onClick={resend} disabled={resending} style={{width:"100%",fontSize:13}}>
              {resending?<Dots/>:"Resend code"}
            </button>
            <button className="bg" style={{width:"100%",fontSize:12}} onClick={()=>{setStep("email");setCodeInput("");setErr("");}}>
              ← Use a different email
            </button>
          </>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECIPE CARD
// ═══════════════════════════════════════════════════════════════════════════════
function RecipeCard({ recipe, onClick, T }) {
  return (
    <div className="card fi" onClick={()=>onClick(recipe)}
      style={{cursor:"pointer",transition:"transform .15s,box-shadow .15s",display:"flex",flexDirection:"column",height:"100%",background:T.surface,border:`1px solid ${T.border}`}}
      onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 6px 20px rgba(0,0,0,.12)"}}
      onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow=""}}>
      {recipe.image
        ? <div style={{height:160,flexShrink:0,overflow:"hidden",borderBottom:`1px solid ${T.border}`}}><img src={recipe.image} alt={recipe.title} style={{width:"100%",height:"100%",objectFit:"cover"}}/></div>
        : <div style={{height:80,flexShrink:0,background:T.paper,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:32}}>🍽️</div>
      }
      <div style={{padding:"12px 14px",flex:1,display:"flex",flexDirection:"column",background:T.surface}}>
        <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:6}}>
          {recipe.tags.slice(0,3).map((t,i)=><span key={t} className={`tag${i%2?" t2":""}`}>{t}</span>)}
        </div>
        <h3 style={{fontFamily:serif,fontSize:16,fontWeight:600,marginBottom:4,color:T.ink}}>{recipe.title}</h3>
        <p style={{fontSize:12,color:T.muted,lineHeight:1.5,marginBottom:8}}>{recipe.description}</p>
        <div style={{display:"flex",gap:12,fontSize:11,color:T.muted,marginTop:"auto"}}>
          {recipe.prepTime&&<span>⏱ {recipe.prepTime}</span>}
          {recipe.cookTime&&<span>🍳 {recipe.cookTime}</span>}
          {recipe.servings&&<span>👤 {recipe.servings}</span>}
        </div>
      </div>
      <div style={{flexShrink:0,background:T.paper,padding:"7px 14px",borderTop:`1px solid ${T.border}`,fontSize:11,color:T.muted}}>
        <strong style={{color:T.ink}}>{recipe.ingredients.length}</strong> ingredients
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECIPE DETAIL / EDIT
// ═══════════════════════════════════════════════════════════════════════════════
function RecipeDetail({ recipe, onClose, onDelete, onSave, settings, T, currentUid="", currentName="" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({...recipe});
  const [newTag, setNewTag] = useState("");
  const [scale, setScale] = useState(1);
  const imageFileRef = useRef();
  const dragStepIdx = useRef(null);

  // Apply scale then conversion settings to view
  const scaledIngredients = draft.ingredients.map(i=>({...i, amount: scale!==1?scaleAmount(i.amount, scale):i.amount}));
  const { ing, steps } = applyCvt(scaledIngredients, draft.steps, settings);
  const converted = settings.weight!=="original"||settings.volume!=="original"||settings.temp!=="original";
  useEffect(()=>{ setDraft({...recipe}); setEditing(false); setScale(1); },[recipe.id]);

  function saveEdit() { onSave(draft); setEditing(false); }
  function addTag() { const t=newTag.trim().toLowerCase(); if(t&&!draft.tags.includes(t))setDraft({...draft,tags:[...draft.tags,t]}); setNewTag(""); }
  function removeTag(t) { setDraft({...draft,tags:draft.tags.filter(x=>x!==t)}); }
  function updateIng(i,field,val) { setDraft({...draft,ingredients:draft.ingredients.map((x,idx)=>idx===i?{...x,[field]:val}:x)}); }
  function addIng() { setDraft({...draft,ingredients:[...draft.ingredients,{amount:"",name:""}]}); }
  function removeIng(i) { setDraft({...draft,ingredients:draft.ingredients.filter((_,idx)=>idx!==i)}); }
  function updateStep(i,val) { setDraft({...draft,steps:draft.steps.map((s,idx)=>idx===i?val:s)}); }
  function addStep() { setDraft({...draft,steps:[...draft.steps,""]}); }
  function removeStep(i) { setDraft({...draft,steps:draft.steps.filter((_,idx)=>idx!==i)}); }
  const [showShare, setShowShare] = useState(false);
  const [dragOverStep, setDragOverStep] = useState(null);
  function onDragStartStep(i) { dragStepIdx.current = i; }
  function onDragOverStep(e,i) { e.preventDefault(); setDragOverStep(i); }
  function onDragEndStep() { setDragOverStep(null); dragStepIdx.current=null; }
  function onDropStep(i) {
    const from=dragStepIdx.current; if(from===null||from===i){setDragOverStep(null);return;}
    const s2=[...draft.steps]; const [m]=s2.splice(from,1); s2.splice(i,0,m);
    setDraft({...draft,steps:s2}); dragStepIdx.current=null; setDragOverStep(null);
  }
  const dragTagIdx = useRef(null);
  const [dragOverTag, setDragOverTag] = useState(null);
  function onDragStartTag(i) { dragTagIdx.current = i; }
  function onDragOverTag(e,i) { e.preventDefault(); setDragOverTag(i); }
  function onDragEndTag() { setDragOverTag(null); dragTagIdx.current=null; }
  function onDropTag(i) {
    const from=dragTagIdx.current; if(from===null||from===i){setDragOverTag(null);return;}
    const t2=[...draft.tags]; const [m]=t2.splice(from,1); t2.splice(i,0,m);
    setDraft({...draft,tags:t2}); dragTagIdx.current=null; setDragOverTag(null);
  }


  function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setDraft({...draft, image: reader.result});
    reader.readAsDataURL(file);
  }

  const displayIng = editing ? draft.ingredients : ing;
  const displaySteps = editing ? draft.steps : steps;

  return (
    <Overlay onClose={onClose}>
      <div className="card fi" style={{width:"100%",maxWidth:740,marginBottom:24,background:T.surface}}>
        {/* Image */}
        {draft.image
          ? <div style={{height:220,overflow:"hidden",position:"relative"}}>
              <img src={draft.image} alt={draft.title} style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              {editing&&<button onClick={()=>setDraft({...draft,image:null})}
                style={{position:"absolute",top:8,right:8,background:"rgba(0,0,0,.5)",color:"#fff",border:"none",borderRadius:20,padding:"4px 10px",fontSize:12,cursor:"pointer"}}>Remove photo</button>}
            </div>
          : editing
            ? <div style={{height:100,background:T.paper,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>
                <button className="bg" onClick={()=>imageFileRef.current.click()} style={{fontSize:13}}>📷 Add photo</button>
                <input ref={imageFileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImageUpload}/>
              </div>
            : <div style={{height:80,background:T.paper,borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:30}}>🍽️</div>
        }
        {editing && draft.image && (
          <div style={{padding:"6px 20px",borderBottom:`1px solid ${T.border}`,background:T.paper}}>
            <button className="bg" onClick={()=>imageFileRef.current.click()} style={{fontSize:12,padding:"4px 10px"}}>📷 Change photo</button>
            <input ref={imageFileRef} type="file" accept="image/*" style={{display:"none"}} onChange={handleImageUpload}/>
          </div>
        )}

        {/* Header */}
        <div style={{padding:"16px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12}}>
          <div style={{flex:1,minWidth:0}}>
            {editing
              ? <><input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} style={{width:"100%",fontSize:19,fontFamily:serif,fontWeight:600,marginBottom:7,background:T.surface,color:T.ink}}/>
                  <textarea value={draft.description||""} onChange={e=>setDraft({...draft,description:e.target.value})} style={{width:"100%",fontSize:13,minHeight:44,background:T.surface,color:T.ink}}/></>
              : <><div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:7}}>{draft.tags.map(t=><span key={t} className="tag">{t}</span>)}</div>
                  <h2 style={{fontFamily:serif,fontSize:22,fontWeight:600,color:T.ink}}>{draft.title}</h2>
                  <p style={{marginTop:4,fontSize:13,color:T.muted}}>{draft.description}</p></>
            }
          </div>
          <div style={{display:"flex",gap:6,flexShrink:0}}>
            {editing
              ? <><button className="bg" onClick={()=>{setDraft({...recipe});setEditing(false);}}>Cancel</button>
                  <button className="bp" onClick={saveEdit}>Save</button></>
              : <><button className="bg" onClick={()=>setShowShare(true)} style={{fontSize:13}}>↗ Share</button>
                  <button className="bg" onClick={()=>setEditing(true)} style={{fontSize:13}}>✎ Edit</button>
                  <button className="bg" onClick={onClose} style={{fontSize:13}}>✕</button></>
            }
          </div>
        </div>

        {/* Tag editor (edit mode) */}
        {editing&&(
          <div style={{padding:"10px 20px",borderBottom:`1px solid ${T.border}`,background:T.paper}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
              <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".07em",color:T.muted}}>Tags</div>
              <div style={{fontSize:10,color:T.muted}}>drag to reorder &nbsp;·&nbsp; first 3 show on card</div>
            </div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
              {draft.tags.map((t,i)=>{
                const isDragging = dragTagIdx.current===i;
                const isOver = dragOverTag===i && dragTagIdx.current!==i;
                return (
                  <span key={t} draggable
                    onDragStart={()=>onDragStartTag(i)}
                    onDragOver={e=>onDragOverTag(e,i)}
                    onDragEnd={onDragEndTag}
                    onDrop={()=>onDropTag(i)}
                    style={{display:"inline-flex",alignItems:"center",gap:3,padding:"3px 8px",borderRadius:20,
                      background:isOver?T.terra:i<3?T.terraLight:"transparent",
                      color:isOver?"#fff":i<3?T.terra:T.muted,
                      border:`1px solid ${i<3?T.terraLight:T.border}`,
                      fontSize:11,fontWeight:500,textTransform:"uppercase",
                      cursor:"grab",opacity:isDragging?0.4:1,
                      transition:"background .1s,color .1s,opacity .1s",
                      outline:isOver?`2px dashed ${T.terra}`:"none"}}>
                    <span style={{fontSize:9,opacity:0.6,marginRight:1}}>⠿</span>
                    {t}
                    <button className="icon-btn" style={{color:isOver?"#fff":i<3?T.terra:T.muted,fontSize:11,padding:"0 1px"}} onClick={()=>removeTag(t)}>×</button>
                  </span>
                );
              })}
              <form onSubmit={e=>{e.preventDefault();addTag();}} style={{display:"flex",gap:4}}>
                <input value={newTag} onChange={e=>setNewTag(e.target.value)} placeholder="+ add tag" style={{width:90,fontSize:12,padding:"3px 8px",borderRadius:20,background:T.surface,color:T.ink}}/>
              </form>
            </div>
          </div>
        )}

        {/* Meta row */}
        <div style={{padding:"10px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",gap:14,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",gap:14,flexWrap:"wrap"}}>
            {editing
              ? [["prepTime","Prep"],["cookTime","Cook"]].map(([k,l])=>(
                  <div key={k}><div style={{fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>{l}</div>
                    <input value={draft[k]||""} onChange={e=>setDraft({...draft,[k]:e.target.value})} style={{width:80,fontSize:13,padding:"3px 7px",background:T.surface,color:T.ink}}/></div>
                )).concat(
                  <div key="servings"><div style={{fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:".06em",marginBottom:2}}>Servings</div>
                    <input type="number" min="1" value={draft.servings||""} onChange={e=>setDraft({...draft,servings:parseInt(e.target.value)||1})} style={{width:60,fontSize:13,padding:"3px 7px",background:T.surface,color:T.ink}}/></div>
                )
              : [["⏱ Prep",draft.prepTime],["🍳 Cook",draft.cookTime]].map(([l,v])=>v?(
                  <div key={l}><div style={{fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:".06em"}}>{l}</div>
                    <div style={{fontSize:14,fontWeight:500,marginTop:2,color:T.ink}}>{v}</div></div>
                ):null).concat(draft.servings?[(
                  <div key="serves">
                    <div style={{fontSize:10,color:T.muted,textTransform:"uppercase",letterSpacing:".06em"}}>👤 Serves</div>
                    <div style={{fontSize:14,fontWeight:500,marginTop:2,color:scale!==1?T.terra:T.ink}}>
                      {scale===1?draft.servings:Math.round(draft.servings*scale*10)/10}
                      {scale!==1&&<span style={{fontSize:10,color:T.muted,marginLeft:4}}>(orig {draft.servings})</span>}
                    </div>
                  </div>
)]:[])
            }
          </div>
          <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
            {converted&&!editing&&<span style={{fontSize:11,color:T.sage,background:T.sageLight,padding:"2px 8px",borderRadius:20}}>converted</span>}
            {!editing&&(
              <div style={{display:"flex",alignItems:"center",gap:2,background:T.paper,border:`1px solid ${T.border}`,borderRadius:20,padding:"3px 6px"}}>
                <span style={{fontSize:10,color:T.muted,paddingRight:4,letterSpacing:".04em",textTransform:"uppercase"}}>Scale</span>
                {[{v:draft.servings?1/draft.servings:1,l:"1 srv"},{v:0.5,l:"½×"},{v:1,l:"1×"},{v:1.5,l:"1½×"},{v:2,l:"2×"},{v:3,l:"3×"},{v:4,l:"4×"}].map(opt=>(
                  <button key={opt.v} onClick={()=>setScale(opt.v)}
                    style={{padding:"2px 7px",borderRadius:14,border:"none",background:scale===opt.v?T.terra:"transparent",color:scale===opt.v?"#fff":T.muted,cursor:"pointer",fontSize:11,fontFamily:sans,fontWeight:scale===opt.v?600:400,transition:"all .12s"}}>
                    {opt.l}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Ingredients + Steps — responsive stack */}
        <div style={{display:"flex",flexWrap:"wrap"}}>
          <div style={{flex:"0 0 200px",minWidth:0,padding:"16px 18px",borderRight:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,background:T.paper}}>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".08em",color:T.muted,marginBottom:9}}>Ingredients</div>
            {editing
              ? <>{draft.ingredients.map((ing2,i)=>(
                  <div key={i} style={{display:"flex",gap:3,marginBottom:5,alignItems:"center"}}>
                    <input value={ing2.amount} onChange={e=>updateIng(i,"amount",e.target.value)} placeholder="amt" style={{width:54,fontSize:12,padding:"3px 5px",background:T.surface,color:T.ink}}/>
                    <input value={ing2.name} onChange={e=>updateIng(i,"name",e.target.value)} placeholder="ingredient" style={{flex:1,fontSize:12,padding:"3px 5px",minWidth:0,background:T.surface,color:T.ink}}/>
                    <button className="icon-btn" onClick={()=>removeIng(i)} style={{color:"#C0392B",fontSize:13}}>×</button>
                  </div>
                ))}
                <button className="bg" onClick={addIng} style={{fontSize:12,padding:"3px 8px",marginTop:3}}>+ add</button></>
              : <ul style={{listStyle:"none",display:"flex",flexDirection:"column",gap:6}}>
                  {ing.map((ing2,i)=>(
                    <li key={i} style={{fontSize:12,lineHeight:1.4}}>
                      <span style={{fontWeight:500,color:T.terra}}>{ing2.amount}</span><br/>
                      <span style={{color:T.ink}}>{ing2.name}</span>
                    </li>
                  ))}
                </ul>
            }
          </div>
          <div style={{flex:"1 1 280px",minWidth:0,padding:"16px 18px"}}>
            <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".08em",color:T.muted,marginBottom:11}}>Instructions</div>
            {editing
              ? <>{draft.steps.map((step,i)=>{
                    const isDragging = dragStepIdx.current===i;
                    const isOver = dragOverStep===i && dragStepIdx.current!==i;
                    return (
                    <div key={i} draggable
                      onDragStart={()=>onDragStartStep(i)}
                      onDragOver={e=>onDragOverStep(e,i)}
                      onDragEnd={onDragEndStep}
                      onDrop={()=>onDropStep(i)}
                      style={{display:"flex",gap:5,marginBottom:7,alignItems:"flex-start",cursor:"grab",
                        opacity:isDragging?0.4:1,
                        borderRadius:6,
                        padding:"3px 3px 3px 0",
                        background:isOver?"rgba(196,98,45,0.08)":"transparent",
                        borderTop:isOver?`2px dashed ${T.terra}`:"2px solid transparent",
                        transition:"background .1s,border-color .1s"}}>
                      <span title="Drag to reorder" style={{flexShrink:0,fontSize:16,color:isOver?T.terra:T.muted,marginTop:7,lineHeight:1,userSelect:"none",cursor:"grab"}}>⠿</span>
                      <span style={{flexShrink:0,width:19,height:19,borderRadius:"50%",background:isOver?T.terra:T.terraLight,color:isOver?"#fff":T.terra,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,marginTop:5,transition:"background .1s"}}>{i+1}</span>
                      <textarea value={step} onChange={e=>updateStep(i,e.target.value)} style={{flex:1,fontSize:13,minHeight:48,background:T.surface,color:T.ink,cursor:"text",borderColor:isOver?T.terra:T.border}}/>
                      <button className="icon-btn" onClick={()=>removeStep(i)} style={{color:"#C0392B",marginTop:5}}>×</button>
                    </div>
                  );})}
                <button className="bg" onClick={addStep} style={{fontSize:12,padding:"3px 8px",marginTop:3}}>+ add step</button></>
              : <ol style={{listStyle:"none",display:"flex",flexDirection:"column",gap:11}}>
                  {steps.map((step,i)=>(
                    <li key={i} style={{display:"flex",gap:9,fontSize:13,lineHeight:1.6}}>
                      <span style={{flexShrink:0,width:19,height:19,borderRadius:"50%",background:T.terraLight,color:T.terra,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:600,marginTop:2}}>{i+1}</span>
                      <span style={{color:T.ink}}>{step}</span>
                    </li>
                  ))}
                </ol>
            }
          </div>
        </div>

        {/* Notes */}
        <div style={{padding:"12px 20px",borderTop:`1px solid ${T.border}`,background:T.paper}}>
          <div style={{fontSize:10,textTransform:"uppercase",letterSpacing:".08em",color:T.muted,marginBottom:5}}>Notes</div>
          {editing
            ? <textarea value={draft.notes||""} onChange={e=>setDraft({...draft,notes:e.target.value})} placeholder="Add personal notes, tips, substitutions..." style={{width:"100%",minHeight:60,background:T.surface,color:T.ink}}/>
            : draft.notes
              ? <p style={{fontSize:13,color:T.ink,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{draft.notes}</p>
              : <p style={{fontSize:13,color:T.muted,fontStyle:"italic"}}>No notes yet. Click Edit to add some.</p>
          }
        </div>

        {/* Footer — delete only in edit mode */}
        {editing&&(
          <div style={{padding:"10px 20px",borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"flex-end",gap:8}}>
            <button className="bg" style={{color:"#C0392B",borderColor:"#F5C6BB"}} onClick={()=>{onDelete(recipe.id);onClose();}}>Delete recipe</button>
          </div>
        )}
      </div>
      {showShare&&<ShareModal recipe={recipe} currentUid={currentUid} currentName={currentName} onClose={()=>setShowShare(false)} T={T}/>}
    </Overlay>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMPORT TOAST — lives outside modal, always visible when import is running
// ═══════════════════════════════════════════════════════════════════════════════
function ImportToast({ importJob, onExpand, T }) {
  const steps = ["Fetching","Extracting","Parsing","Done"];
  const idx = steps.indexOf(importJob.step);
  const pct = importJob.step === "Done" ? 100 : Math.max(10, Math.round(((idx+1)/(steps.length-1))*100));
  return (
    <div onClick={onExpand}
      style={{position:"fixed",bottom:20,right:20,zIndex:500,background:T.surface,border:`1px solid ${T.border}`,borderRadius:12,padding:"11px 16px",boxShadow:"0 4px 24px rgba(0,0,0,.2)",cursor:"pointer",minWidth:240,display:"flex",alignItems:"center",gap:10}}>
      <div style={{flex:1}}>
        <div style={{fontSize:12,fontWeight:500,color:T.ink,marginBottom:6}}>
          {importJob.step==="Done" ? "Recipe ready — click to review" : importJob.label||"Importing recipe…"}
        </div>
        <div style={{height:4,borderRadius:2,background:T.border,overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:2,background:importJob.step==="Done"?T.sage:T.terra,width:`${pct}%`,transition:"width .4s ease"}}/>
        </div>
        <div style={{fontSize:10,color:T.muted,marginTop:3}}>
          {importJob.step==="Done" ? "✓ Complete" : `${importJob.step}… ${pct}%`}
        </div>
      </div>
      <span style={{fontSize:11,color:T.muted}}>{importJob.step==="Done"?"→":"↑"}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADD RECIPE MODAL — pure UI shell, import logic lives in App via importJob prop
// ═══════════════════════════════════════════════════════════════════════════════
function AddModal({ onClose, T, importJob, onStartImport }) {
  const [mode, setMode] = useState("url");
  const [urlInput, setUrlInput] = useState("");
  const [files, setFiles] = useState([]);
  const [capturedImage, setCapturedImage] = useState(null);
  const fileRef = useRef();
  const videoRef = useRef();
  const canvasRef = useRef();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState(null);
  const [manual, setManual] = useState({title:"",description:"",prepTime:"",cookTime:"",servings:"",tags:"",notes:"",ingredients:"",steps:""});

  const loading = importJob?.loading || false;
  const error = importJob?.error || "";
  const parsed = importJob?.parsed || null;

  async function openCamera() {
    try { const s=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}}); setCameraStream(s); setCameraOpen(true); setTimeout(()=>{if(videoRef.current){videoRef.current.srcObject=s;videoRef.current.play();}},80); }
    catch { onStartImport({type:"error",error:"Camera unavailable. Upload a file instead."}); }
  }
  function closeCamera() { if(cameraStream)cameraStream.getTracks().forEach(t=>t.stop()); setCameraStream(null); setCameraOpen(false); }
  function snap() {
    const v=videoRef.current,cv=canvasRef.current; if(!v||!cv)return;
    cv.width=v.videoWidth;cv.height=v.videoHeight;cv.getContext("2d").drawImage(v,0,0);
    const img=cv.toDataURL("image/jpeg",.85);
    setCapturedImage(img); closeCamera();
    // Kick off photo import immediately
    onStartImport({type:"photo", imgSrc:img});
  }

  async function readFiles() {
    const imgFile=files.find(f=>f.type.startsWith("image/")), docFile=files.find(f=>!f.type.startsWith("image/"));
    const parts=[]; let imgSrc=null;
    if(imgFile){imgSrc=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(imgFile)});parts.push({type:"image",source:{type:"base64",media_type:imgFile.type,data:imgSrc.split(",")[1]}});}
    if(docFile){
      if(docFile.type==="application/pdf"){
        try {
          const pdfText = await extractPdfText(docFile);
          parts.push({type:"text",text:`Document (PDF):\n${pdfText}`.slice(0,14000)});
        } catch(e) {
          onStartImport({type:"error", error:"Couldn\'t read the PDF. Try a different file or paste the recipe text directly."});
          return;
        }
      } else {
        const txt=await docFile.text();
        parts.push({type:"text",text:`Document:\n${txt}`.slice(0,14000)});
      }
    }
    parts.push({type:"text",text:"Extract the recipe."});
    onStartImport({type:"parts", parts, imgSrc});
  }

  // Auto-minimize on outside click when loading
  function handleOverlayClose() {
    if (loading) { /* just close the overlay — import continues via importJob in App */ onClose(); }
    else onClose();
  }

  const modes=[{id:"url",l:"URL / Paste"},{id:"manual",l:"Manual"},{id:"image",l:"Upload file"},{id:"camera",l:"📷 Camera"}];
  const progressSteps=["Fetching","Extracting","Parsing"];
  const stepIdx=progressSteps.indexOf(importJob?.step||"");
  const pct=loading?Math.max(10,Math.round(((stepIdx+1)/progressSteps.length)*100)):0;

  return (
    <Overlay onClose={handleOverlayClose}>
      <div className="card fi" style={{width:"100%",maxWidth:540,marginBottom:24,background:T.surface}}>
        <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h3 style={{fontFamily:serif,fontSize:18,color:T.ink}}>Add a recipe</h3>
          <div style={{display:"flex",gap:6}}>
            {loading&&<button className="bg" style={{fontSize:12,padding:"5px 10px"}} onClick={onClose}>Minimize ↓</button>}
            <button className="bg" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Progress bar */}
        {loading&&(
          <div style={{padding:"8px 18px",borderBottom:`1px solid ${T.border}`,background:T.paper}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:11,color:T.muted}}>{importJob?.label||"Working…"}</span>
              <span style={{fontSize:11,color:T.terra,fontWeight:500}}>{pct}%</span>
            </div>
            <div style={{height:5,borderRadius:3,background:T.border,overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:3,background:T.terra,width:`${pct}%`,transition:"width .5s ease"}}/>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:5}}>
              {progressSteps.map((s,i)=>(
                <div key={s} style={{display:"flex",alignItems:"center",gap:3}}>
                  <div style={{width:6,height:6,borderRadius:"50%",background:i<=stepIdx?T.terra:T.border,transition:"background .3s"}}/>
                  <span style={{fontSize:9,color:i<=stepIdx?T.terra:T.muted,textTransform:"uppercase",letterSpacing:".05em"}}>{s}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{padding:"14px 18px"}}>
          {!parsed&&!loading&&<div style={{display:"flex",gap:4,marginBottom:16,flexWrap:"wrap"}}>
            {modes.map(m=><button key={m.id} onClick={()=>{setMode(m.id);}}
              style={{padding:"5px 11px",fontSize:12,borderRadius:20,border:`1px solid ${mode===m.id?T.terra:T.border}`,background:mode===m.id?T.terraLight:"transparent",color:mode===m.id?T.terra:T.muted,cursor:"pointer",fontFamily:sans}}>{m.l}</button>)}
          </div>}

          {!parsed&&!loading&&<>
            {mode==="url"&&<div style={{display:"flex",flexDirection:"column",gap:7}}>
              <textarea value={urlInput} onChange={e=>setUrlInput(e.target.value)} placeholder="Paste a recipe URL or full recipe text..." style={{minHeight:100,width:"100%",background:T.surface,color:T.ink}}/>
              <button className="bp" onClick={()=>onStartImport({type:"url",text:urlInput})} disabled={!urlInput.trim()} style={{alignSelf:"flex-end"}}>Extract →</button>
            </div>}
            {mode==="image"&&<div style={{display:"flex",flexDirection:"column",gap:7}}>
              <div onClick={()=>fileRef.current.click()} style={{border:`2px dashed ${T.border}`,borderRadius:8,padding:"22px 14px",textAlign:"center",cursor:"pointer",background:T.paper}}>
                <div style={{fontSize:24,marginBottom:5}}>📎</div>
                {files.length?<p style={{fontSize:13,color:T.ink}}>{files.map(f=>f.name).join(", ")}</p>:<><p style={{fontSize:13,color:T.muted}}>Upload image, PDF, or Word doc</p><p style={{fontSize:11,color:T.muted,marginTop:2}}>JPG, PNG, PDF, DOCX</p></>}
              </div>
              <input ref={fileRef} type="file" accept="image/*,.pdf,.docx,.doc,.txt" multiple style={{display:"none"}} onChange={e=>{setFiles(Array.from(e.target.files));}}/>
              {files.length>0&&<button className="bp" onClick={readFiles} style={{alignSelf:"flex-end"}}>Read & extract →</button>}
            </div>}
            {mode==="camera"&&<div style={{display:"flex",flexDirection:"column",gap:9,alignItems:"center"}}>
              {!cameraOpen&&!capturedImage&&<button className="bp" onClick={openCamera} style={{padding:"11px 22px",fontSize:15}}>📷 Open Camera</button>}
              {cameraOpen&&<div style={{width:"100%"}}><video ref={videoRef} autoPlay playsInline style={{width:"100%",borderRadius:8,background:"#000"}}/><canvas ref={canvasRef} style={{display:"none"}}/>
                <div style={{display:"flex",gap:7,justifyContent:"center",marginTop:7}}>
                  <button className="bp" onClick={snap}>📸 Snap</button>
                  <button className="bg" onClick={closeCamera}>Cancel</button>
                </div></div>}
            </div>}
            {mode==="manual"&&<div style={{display:"flex",flexDirection:"column",gap:7}}>
              <input placeholder="Recipe title" value={manual.title} onChange={e=>setManual({...manual,title:e.target.value})} style={{width:"100%",background:T.surface,color:T.ink}}/>
              <textarea placeholder="Short description" value={manual.description} onChange={e=>setManual({...manual,description:e.target.value})} style={{minHeight:44,width:"100%",background:T.surface,color:T.ink}}/>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3, minmax(0, 1fr))",gap:6}}>
                {[["prepTime","Prep"],["cookTime","Cook"],["servings","Serves"]].map(([k,p])=><input key={k} placeholder={p} value={manual[k]} onChange={e=>setManual({...manual,[k]:e.target.value})} style={{background:T.surface,color:T.ink,width:"100%",minWidth:0,padding:"8px 8px"}}/>)}
              </div>
              <input placeholder="Tags: italian, pasta, vegetarian" value={manual.tags} onChange={e=>setManual({...manual,tags:e.target.value})} style={{width:"100%",background:T.surface,color:T.ink}}/>
              <textarea placeholder={"Ingredients:\n2 cups flour\n1 tsp salt"} value={manual.ingredients} onChange={e=>setManual({...manual,ingredients:e.target.value})} style={{minHeight:80,width:"100%",background:T.surface,color:T.ink}}/>
              <textarea placeholder={"Steps:\n1. Preheat oven...\n2. Mix..."} value={manual.steps} onChange={e=>setManual({...manual,steps:e.target.value})} style={{minHeight:80,width:"100%",background:T.surface,color:T.ink}}/>
              <textarea placeholder="Notes or tips (optional)" value={manual.notes} onChange={e=>setManual({...manual,notes:e.target.value})} style={{minHeight:44,width:"100%",background:T.surface,color:T.ink}}/>
              <button className="bp" onClick={()=>onStartImport({type:"manual",manual})} disabled={!manual.title.trim()} style={{alignSelf:"flex-end"}}>Preview →</button>
            </div>}
          </>}

          {loading&&!parsed&&<div style={{textAlign:"center",padding:"24px 0",color:T.muted,fontSize:13}}>
            <Dots/> &nbsp; {importJob?.label||"Importing…"}
          </div>}

          {error&&<div style={{marginTop:8,padding:"8px 12px",background:"#FEF2F2",borderRadius:6,border:"1px solid #FECACA",color:"#991B1B",fontSize:13}}>{error}</div>}

          {parsed&&<div className="fi">
            {importJob?.capturedImage&&<div style={{marginBottom:9,borderRadius:7,overflow:"hidden",maxHeight:150}}><img src={importJob.capturedImage} style={{width:"100%",objectFit:"cover",maxHeight:150}}/></div>}
            <div style={{padding:"11px 13px",background:T.paper,borderRadius:8,border:`1px solid ${T.border}`,marginBottom:11}}>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:4}}>{(parsed.tags||[]).map(t=><span key={t} className="tag">{t}</span>)}</div>
              <h4 style={{fontFamily:serif,fontSize:16,fontWeight:600,marginBottom:3,color:T.ink}}>{parsed.title}</h4>
              <p style={{fontSize:12,color:T.muted}}>{parsed.description}</p>
              <div style={{marginTop:7,display:"flex",gap:11,fontSize:11,color:T.muted}}>
                {parsed.prepTime&&<span>⏱ {parsed.prepTime}</span>}{parsed.cookTime&&<span>🍳 {parsed.cookTime}</span>}{parsed.servings&&<span>👤 {parsed.servings}</span>}
              </div>
              <div style={{marginTop:5,fontSize:11,color:T.muted}}>
                <strong>{parsed.ingredients?.length||0}</strong> ingredients · <strong>{parsed.steps?.length||0}</strong> steps{parsed.notes?" · notes included":""}
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <button className="bg" onClick={()=>onStartImport({type:"reset"})}>← Retry</button>
              <button className="bp" onClick={()=>{ onStartImport({type:"save"}); }}>Save to cookbook →</button>
            </div>
          </div>}
        </div>
      </div>
    </Overlay>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHARE MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function ShareModal({ recipe, currentUid, currentName, onClose, T }) {
  const [tab, setTab] = useState("user"); // user | link | text
  const [toEmail, setToEmail] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const shareLink = encodeShareLink(recipe);
  const shareText = recipeToText(recipe);

  async function sendToUser() {
    setStatus("");
    const key = toEmail.trim().toLowerCase();
    if (!key.includes("@")) { setStatus("Enter a valid email address."); return; }
    if (key === currentUid) { setStatus("That's your own email!"); return; }
    setStatus("Sending...");
    try {
      const exists = await sbCheckUserExists(key);
      if (!exists) { setStatus("No myrecipecards account found for that email. They need to sign up first."); return; }
      await sbShareRecipe(key, recipe, currentName, currentUid);
      setStatus("✓ Sent! They'll see it next time they open the app.");
      setToEmail("");
    } catch(e) {
      console.error(e);
      setStatus("Couldn't send. Please try again.");
    }
  }

  function copyLink() {
    if (!shareLink) { setStatus("Link too large — try sharing via user instead."); return; }
    navigator.clipboard.writeText(shareLink).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  }
  function copyText() {
    navigator.clipboard.writeText(shareText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); });
  }

  const tabs = [{id:"user",l:"👤 Send to user"},{id:"link",l:"🔗 Share link"},{id:"text",l:"📋 Copy text"}];

  return (
    <Overlay onClose={onClose} zIndex={200}>
      <div className="card fi" style={{width:"100%",maxWidth:460,marginBottom:24,background:T.surface}}>
        <div style={{padding:"14px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <h3 style={{fontFamily:serif,fontSize:18,color:T.ink}}>Share recipe</h3>
            <p style={{fontSize:12,color:T.muted,marginTop:2}}>{recipe.title}</p>
          </div>
          <button className="bg" onClick={onClose}>✕</button>
        </div>
        <div style={{display:"flex",borderBottom:`1px solid ${T.border}`}}>
          {tabs.map(t=><button key={t.id} onClick={()=>{setTab(t.id);setStatus("");setCopied(false);}}
            className={"nav-btn"+(tab===t.id?" active":"")} style={{flex:1,fontSize:12,padding:"9px 4px",textAlign:"center"}}>{t.l}</button>)}
        </div>
        <div style={{padding:"16px 20px"}}>
          {tab==="user"&&<>
            <p style={{fontSize:13,color:T.muted,marginBottom:12,lineHeight:1.5}}>
              Send this recipe directly to another <em>myrecipecards</em> user. It will appear in their inbox the next time they open the app.
            </p>
            <div style={{display:"flex",gap:8}}>
              <input value={toEmail} onChange={e=>setToEmail(e.target.value)} placeholder="their@email.com"
                style={{flex:1,background:T.surface,color:T.ink}} type="email"
                onKeyDown={e=>e.key==="Enter"&&sendToUser()}/>
              <button className="bp" onClick={sendToUser} style={{padding:"8px 16px"}}>Send</button>
            </div>
            {status&&<p style={{fontSize:12,marginTop:8,color:status.startsWith("✓")?T.sage:"#C0392B"}}>{status}</p>}
          </>}

          {tab==="link"&&<>
            <p style={{fontSize:13,color:T.muted,marginBottom:12,lineHeight:1.5}}>
              Anyone with this link can open the app and import this recipe — even without an account.
              {recipe.image&&!recipe.image.startsWith("http")&&<span style={{color:T.terra}}> Note: locally-uploaded photos are not included in the link.</span>}
            </p>
            <div style={{display:"flex",gap:8,marginBottom:10}}>
              <input readOnly value={shareLink||"Recipe too large for a link"} style={{flex:1,background:T.paper,color:T.muted,fontSize:12}}/>
              <button className="bp" onClick={copyLink} style={{padding:"8px 14px",flexShrink:0}}>
                {copied?"✓ Copied!":"Copy link"}
              </button>
            </div>
            {shareLink&&(
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <a href={`mailto:?subject=${encodeURIComponent("Recipe: "+recipe.title)}&body=${encodeURIComponent("I wanted to share this recipe with you!\n\n"+shareLink)}`}
                  style={{textDecoration:"none"}}><button className="bg" style={{fontSize:12}}>📧 Email link</button></a>
                <a href={`sms:?body=${encodeURIComponent(recipe.title+" recipe: "+shareLink)}`}
                  style={{textDecoration:"none"}}><button className="bg" style={{fontSize:12}}>💬 Text link</button></a>
              </div>
            )}
          </>}

          {tab==="text"&&<>
            <p style={{fontSize:13,color:T.muted,marginBottom:10,lineHeight:1.5}}>
              Copy the recipe as formatted text to paste anywhere — email, notes, messages.
            </p>
            <pre style={{background:T.paper,borderRadius:7,padding:"10px 12px",fontSize:11,lineHeight:1.6,color:T.ink,whiteSpace:"pre-wrap",maxHeight:260,overflowY:"auto",border:`1px solid ${T.border}`}}>
              {shareText}
            </pre>
            <button className="bp" onClick={copyText} style={{width:"100%",marginTop:10}}>
              {copied?"✓ Copied to clipboard!":"Copy recipe text"}
            </button>
          </>}
        </div>
      </div>
    </Overlay>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS MODAL// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsModal({ settings, onChange, onClose, trash, onRestore, T }) {
  const [tab, setTab] = useState("prefs");
  const Row = ({label,desc,k,opts})=>(
    <div className="srow">
      <div><div style={{fontSize:14,fontWeight:500,color:T.ink}}>{label}</div>{desc&&<div style={{fontSize:11,color:T.muted,marginTop:1}}>{desc}</div>}</div>
      <select value={settings[k]} onChange={e=>onChange({...settings,[k]:e.target.value})} style={{background:T.surface,color:T.ink}}>{opts.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}</select>
    </div>
  );
  const now = Date.now();
  const validTrash = trash.filter(r=>{ const age=(now-new Date(r.deletedAt).getTime())/(1000*60*60*24); return age<=30; });

  return (
    <Overlay onClose={onClose} zIndex={200}>
      <div className="card fi" style={{width:"100%",maxWidth:460,marginBottom:24,background:T.surface}}>
        <div style={{padding:"14px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h3 style={{fontFamily:serif,fontSize:18,color:T.ink}}>Settings</h3>
          <button className="bg" onClick={onClose}>✕</button>
        </div>
        <div style={{display:"flex",borderBottom:`1px solid ${T.border}`}}>
          {["prefs","trash"].map(t=>(
            <button key={t} className={`nav-btn${tab===t?" active":""}`} onClick={()=>setTab(t)} style={{flex:1,textAlign:"center",fontSize:13}}>
              {t==="prefs"?"Preferences":`🗑 Recycle Bin (${validTrash.length})`}
            </button>
          ))}
        </div>
        {tab==="prefs"&&<div style={{padding:"4px 20px 10px"}}>
          <p style={{fontSize:11,color:T.muted,padding:"12px 0 6px",textTransform:"uppercase",letterSpacing:".06em"}}>Appearance</p>
          <div className="srow">
            <div><div style={{fontSize:14,fontWeight:500,color:T.ink}}>Theme</div></div>
            <div style={{display:"flex",gap:0,border:`1px solid ${T.border}`,borderRadius:8,overflow:"hidden"}}>
              {[{v:"light",l:"☀ Light"},{v:"system",l:"⚙ System"},{v:"dark",l:"🌙 Dark"}].map(opt=>(
                <button key={opt.v} onClick={()=>onChange({...settings,dark:opt.v})}
                  style={{padding:"6px 12px",fontSize:12,background:settings.dark===opt.v?T.terra:"transparent",color:settings.dark===opt.v?"#fff":T.muted,border:"none",cursor:"pointer",fontFamily:sans,fontWeight:settings.dark===opt.v?500:400,transition:"all .15s"}}>
                  {opt.l}
                </button>
              ))}
            </div>
          </div>
          <Row label="Week starts on" k="weekStart" opts={[{v:"sun",l:"Sunday"},{v:"mon",l:"Monday"}]}/>
          <p style={{fontSize:11,color:T.muted,padding:"12px 0 4px",textTransform:"uppercase",letterSpacing:".06em"}}>Measurements</p>
          <p style={{fontSize:12,color:T.muted,marginBottom:7}}>Conversions apply when viewing. Originals preserved.</p>
          <Row label="Weight" desc="g, kg, oz, lb" k="weight" opts={[{v:"original",l:"Original"},{v:"metric",l:"Metric (g/kg)"},{v:"imperial",l:"Imperial (oz/lb)"}]}/>
          <Row label="Volume" desc="ml, L, cups, tsp" k="volume" opts={[{v:"original",l:"Original"},{v:"metric",l:"Metric (ml/L)"},{v:"imperial",l:"Imperial (cups)"}]}/>
          <Row label="Temperature" desc="°C / °F" k="temp" opts={[{v:"original",l:"Original"},{v:"c",l:"Celsius"},{v:"f",l:"Fahrenheit"}]}/>
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between"}}>
            <button className="bg" onClick={()=>onChange({...settings,weight:"original",volume:"original",temp:"original"})}>Reset measurements</button>
            <button className="bp" onClick={onClose}>Done</button>
          </div>
        </div>}
        {tab==="trash"&&<div style={{padding:"12px 20px"}}>
          {validTrash.length===0
            ? <p style={{color:T.muted,fontSize:13,textAlign:"center",padding:"20px 0"}}>Recycle bin is empty. Deleted recipes appear here for 30 days.</p>
            : validTrash.map(r=>{
              const daysLeft = Math.ceil(30 - (now-new Date(r.deletedAt).getTime())/(1000*60*60*24));
              return (
                <div key={r.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${T.border}`,gap:10}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:500,color:T.ink}}>{r.title}</div>
                    <div style={{fontSize:11,color:T.muted}}>Deleted · {daysLeft} day{daysLeft!==1?"s":""} left</div>
                  </div>
                  <button className="bg" style={{fontSize:12,padding:"4px 10px"}} onClick={()=>onRestore(r.id)}>Restore</button>
                </div>
              );
            })
          }
        </div>}
      </div>
    </Overlay>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEAL PLAN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function MealPlanPage({ recipes, mealPlan, onMealPlanChange, settings, T }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [pickerDay, setPickerDay] = useState(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [showGrocery, setShowGrocery] = useState(false);
  const [phone, setPhone] = useState("");
  const [smsStatus, setSmsStatus] = useState("");
  const [copiedGrocery, setCopiedGrocery] = useState(false);
  const [selectedGroceryDays, setSelectedGroceryDays] = useState(null); // null = default to visible calendar scope
  // Drag-to-copy state
  const dragMeal = useRef(null); // { fromDk, mealIdx, meal }
  const [dragOverDk, setDragOverDk] = useState(null); // dateKey being hovered
  const startMonday = settings.weekStart === "mon";
  const todayKey = dateKey(now);

  const cells = getMonthDays(year, month, startMonday);

  // All dates shown on the current calendar view — current month + overflow days
  // from prev/next month that fill the first/last partial weeks.
  const visibleDateKeys = new Set(cells.map(({date}) => dateKey(date)));

  // Automatic grocery scope: visible calendar dates that HAVE meals planned.
  // This updates live as meals are added/removed — no manual selection needed.
  const autoGroceryDays = new Set(
    [...visibleDateKeys].filter(dk => (mealPlan[dk]||[]).length > 0)
  );

  // selectedGroceryDays === null means "use automatic scope".
  // Once the user manually toggles a day it becomes a Set they control.
  const activeGroceryDays = selectedGroceryDays === null ? autoGroceryDays : selectedGroceryDays;
  const dayLabels = startMonday ? DAY_LABELS_MON : DAY_LABELS_SUN;

  function addMeal(dk, recipeId) {
    const recipe = recipes.find(r=>r.id===recipeId);
    const prev = mealPlan[dk]||[];
    onMealPlanChange({...mealPlan,[dk]:[...prev,{recipeId,servings:recipe?.servings||4}]});
    setPickerDay(null); setPickerSearch("");
  }
  function removeMeal(dk, idx) {
    const next=(mealPlan[dk]||[]).filter((_,i)=>i!==idx);
    onMealPlanChange({...mealPlan,[dk]:next.length?next:undefined});
  }
  function updateServings(dk, idx, val) {
    const next=(mealPlan[dk]||[]).map((m,i)=>i===idx?{...m,servings:Math.max(1,parseInt(val)||1)}:m);
    onMealPlanChange({...mealPlan,[dk]:next});
  }
  function prevMonth() { if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }
  function nextMonth() { if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }

  function toggleGroceryDay(dk) {
    setSelectedGroceryDays(prev => {
      // First customization: start from the current auto scope (meals on visible days)
      const base = prev === null ? new Set(autoGroceryDays) : new Set(prev);
      if (base.has(dk)) base.delete(dk); else base.add(dk);
      return base;
    });
  }
  function resetGroceryFilter() { setSelectedGroceryDays(null); }

  function onMealDragStart(e, fromDk, mealIdx, meal) {
    dragMeal.current = { fromDk, mealIdx, meal };
    e.dataTransfer.effectAllowed = "copyMove";
    e.dataTransfer.setData("text/plain", meal.recipeId); // required for Firefox
  }
  function onCellDragOver(e, dk) {
    if (!dragMeal.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = e.altKey ? "move" : "copy";
    setDragOverDk(dk);
  }
  function onCellDragLeave() { setDragOverDk(null); }
  function onCellDrop(e, dk) {
    e.preventDefault();
    const drag = dragMeal.current;
    if (!drag) return;
    const isMove = e.altKey;
    const newMealPlan = {...mealPlan};
    // Add to target day
    const targetMeals = [...(newMealPlan[dk]||[]), {...drag.meal}];
    newMealPlan[dk] = targetMeals;
    // If moving (alt key), remove from source day
    if (isMove && drag.fromDk !== dk) {
      const src = [...(newMealPlan[drag.fromDk]||[])];
      src.splice(drag.mealIdx, 1);
      if (src.length > 0) newMealPlan[drag.fromDk] = src;
      else delete newMealPlan[drag.fromDk];
    }
    onMealPlanChange(newMealPlan);
    dragMeal.current = null;
    setDragOverDk(null);
  }
  function onDragEnd() { dragMeal.current = null; setDragOverDk(null); }

  // Build filtered meal plan — always filtered to the active day scope
  const groceryMealPlan = Object.fromEntries(
    Object.entries(mealPlan).filter(([dk]) => activeGroceryDays.has(dk))
  );

  // Apply measurement conversions to grocery amounts
  const groceryItemsRaw = buildGroceryList(groceryMealPlan, recipes);
  const groceryItems = groceryItemsRaw.map(item => ({
    ...item,
    displayAmount: cvt(item.displayAmount, settings),
    subLines: item.subLines.map(l => {
      // Apply conversion only to the amount part before the dash
      const dashIdx = l.indexOf(" — ");
      if (dashIdx === -1) return cvt(l, settings);
      return cvt(l.slice(0, dashIdx), settings) + l.slice(dashIdx);
    }),
  }));

  const [checkedItems, setCheckedItems] = useState({});
  function toggleCheck(name) { setCheckedItems(prev=>({...prev,[name]:!prev[name]})); }

  // hasDayFilter: true when user has manually selected a subset (not using default visible scope)
  const isCustomFilter = selectedGroceryDays !== null;
  const hasDayFilter = isCustomFilter;

  function groceryText() {
    const label = isCustomFilter ? `🛒 Grocery List (${(selectedGroceryDays||new Set()).size} days)` : `🛒 Grocery List — ${MONTH_NAMES[month]} ${year} (auto)`;
    if(!groceryItems.length) return "No groceries planned.";
    const lines=[label,""];
    groceryItems.forEach(item=>{
      lines.push(`• ${item.name}: ${item.displayAmount}`);
      // Always show sub-lines for non-numeric items (they carry the \u00d7N count + recipe name),
      // and for numeric items only when more than one recipe contributed.
      if (item.isNonNumeric || item.subLines.length>1) {
        item.subLines.forEach(l=>lines.push(`    \u21b3 ${l}`));
      }
    });
    return lines.join("\n");
  }

  const filteredPicker = recipes.filter(r=>r.title.toLowerCase().includes(pickerSearch.toLowerCase())||r.tags.some(t=>t.includes(pickerSearch.toLowerCase())));
  const checkedCount = Object.values(checkedItems).filter(Boolean).length;

  return (
    <div style={{maxWidth:1100,margin:"0 auto",padding:"20px 16px"}}>
      {/* Month nav */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button className="bg" onClick={prevMonth} style={{padding:"6px 12px"}}>‹</button>
          <h2 style={{fontFamily:serif,fontSize:20,color:T.ink,minWidth:180,textAlign:"center"}}>{MONTH_NAMES[month]} {year}</h2>
          <button className="bg" onClick={nextMonth} style={{padding:"6px 12px"}}>›</button>
          {(year!==now.getFullYear()||month!==now.getMonth())&&<button className="bg" onClick={()=>{setYear(now.getFullYear());setMonth(now.getMonth());}} style={{fontSize:12}}>Today</button>}
        </div>
        <button className="bp" onClick={()=>setShowGrocery(true)}>🛒 Grocery List</button>
      </div>

      {/* Day headers */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
        {dayLabels.map(d=><div key={d} style={{textAlign:"center",fontSize:11,fontWeight:500,color:T.muted,textTransform:"uppercase",letterSpacing:".05em",padding:"4px 0"}}>{d}</div>)}
      </div>

      {/* Calendar grid */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4}}>
        {cells.map(({date,thisMonth},ci)=>{
          const dk=dateKey(date);
          const meals=mealPlan[dk]||[];
          const isPast = dk < todayKey;
          const isToday = dk === todayKey;
          const isGrocerySelected = activeGroceryDays.has(dk) && meals.length > 0;
          const hasMeals = meals.length > 0;
          return (
            <div key={dk+ci}
              onDragOver={e=>onCellDragOver(e,dk)}
              onDragLeave={onCellDragLeave}
              onDrop={e=>onCellDrop(e,dk)}
              style={{minHeight:110,borderRadius:7,
                border:`2px solid ${dragOverDk===dk?"#2E7D4F":isToday?T.terra:T.border}`,
                background:dragOverDk===dk?"rgba(46,125,79,0.08)":isToday?T.terraLight:T.surface,
                padding:"6px 6px 0px",display:"flex",flexDirection:"column",gap:3,
                opacity:thisMonth?(isPast?0.55:1):0.3,overflow:"hidden",position:"relative",
                transition:"border-color .1s,background .1s"}}>
              {/* Grocery selected indicator — green left stripe, always visible regardless of today */}
              {isGrocerySelected&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:4,background:"#2E7D4F",borderRadius:"5px 0 0 5px"}}/>}
              <div style={{padding:"0 0 5px",paddingLeft:isGrocerySelected?7:0,display:"flex",flexDirection:"column",gap:3,flex:1}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:1}}>
                <div style={{fontFamily:serif,fontSize:13,fontWeight:isToday?600:400,color:isToday?T.terra:T.ink}}>{date.getDate()}</div>
                {thisMonth&&hasMeals&&(
                  <button title={isGrocerySelected?"Remove from grocery list":"Add to grocery list"}
                    onClick={e=>{e.stopPropagation();toggleGroceryDay(dk);}}
                    style={{fontSize:10,background:isGrocerySelected?"#2E7D4F":"none",color:isGrocerySelected?"#fff":T.muted,border:`1px solid ${isGrocerySelected?"#2E7D4F":T.border}`,borderRadius:10,cursor:"pointer",padding:"1px 5px",lineHeight:1.4,fontFamily:sans,transition:"all .15s"}}>
                    {isGrocerySelected?"✓ list":"+ list"}
                  </button>
                )}
              </div>
              {meals.map((meal,mi)=>{
                const recipe=recipes.find(r=>r.id===meal.recipeId);
                return recipe?(
                  <div key={mi}
                    draggable
                    onDragStart={e=>onMealDragStart(e,dk,mi,meal)}
                    onDragEnd={onDragEnd}
                    style={{background:T.paper,borderRadius:4,border:`1px solid ${T.border}`,padding:"4px 5px",fontSize:10,cursor:"grab",userSelect:"none"}}>
                    {/* Title row with × on the right */}
                    <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:2,marginBottom:3}}>
                      <div style={{fontWeight:500,color:T.ink,lineHeight:1.25,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0}}>
                        <span style={{fontSize:8,color:T.muted,marginRight:3}}>⠿</span>{recipe.title}
                      </div>
                      <button onClick={()=>removeMeal(dk,mi)}
                        style={{flexShrink:0,background:"none",border:"none",cursor:"pointer",color:"#C0392B",fontSize:14,lineHeight:1,padding:"0 1px",fontFamily:sans,fontWeight:600}}>×</button>
                    </div>
                    {/* Servings row — no spinner arrows overlap */}
                    <div style={{display:"flex",alignItems:"center",gap:4}}>
                      <span style={{fontSize:9,color:T.muted}}>👤</span>
                      <button onClick={()=>updateServings(dk,mi,meal.servings-1)}
                        style={{width:16,height:16,borderRadius:3,border:`1px solid ${T.border}`,background:T.surface,color:T.ink,fontSize:11,lineHeight:1,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontFamily:sans}}>−</button>
                      <span style={{fontSize:11,fontWeight:500,color:T.ink,minWidth:14,textAlign:"center"}}>{meal.servings}</span>
                      <button onClick={()=>updateServings(dk,mi,meal.servings+1)}
                        style={{width:16,height:16,borderRadius:3,border:`1px solid ${T.border}`,background:T.surface,color:T.ink,fontSize:11,lineHeight:1,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,fontFamily:sans}}>+</button>
                    </div>
                  </div>
                ):null;
              })}
              {thisMonth&&(
                <button onClick={()=>{setPickerDay(dk);setPickerSearch("");}}
                  style={{marginTop:"auto",background:"none",border:`1px dashed ${T.border}`,borderRadius:4,padding:"2px 0",fontSize:10,color:T.muted,cursor:"pointer",fontFamily:sans}}>+ add</button>
              )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Drag hint */}
      <p style={{fontSize:11,color:T.muted,textAlign:"center",marginTop:6}}>
        Drag a meal to copy it to another day &nbsp;·&nbsp; Hold <kbd style={{background:T.paper,border:`1px solid ${T.border}`,borderRadius:3,padding:"0 4px",fontSize:10}}>Alt</kbd> while dropping to move instead
      </p>

      {/* Recipe picker overlay */}
      {pickerDay&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",zIndex:150,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
          onMouseDown={e=>{if(e.target===e.currentTarget){setPickerDay(null);setPickerSearch("");}}}>
          <div className="card fi" style={{width:"100%",maxWidth:500,background:T.surface}}>
            <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <h3 style={{fontFamily:serif,fontSize:17,color:T.ink}}>Add meal</h3>
                <p style={{fontSize:12,color:T.muted,marginTop:2}}>{new Date(pickerDay+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}</p>
              </div>
              <button className="bg" onClick={()=>{setPickerDay(null);setPickerSearch("");}}>✕</button>
            </div>
            <div style={{padding:"12px 18px"}}>
              <input autoFocus value={pickerSearch} onChange={e=>setPickerSearch(e.target.value)} placeholder="Search recipes..." style={{width:"100%",marginBottom:10,background:T.surface,color:T.ink}}/>
              <div style={{maxHeight:340,overflowY:"auto",display:"flex",flexDirection:"column",gap:5}}>
                {filteredPicker.map(r=>(
                  <button key={r.id} onClick={()=>addMeal(pickerDay,r.id)}
                    style={{background:"none",border:`1px solid ${T.border}`,borderRadius:7,textAlign:"left",padding:"9px 12px",cursor:"pointer",fontFamily:sans,transition:"background .1s"}}
                    onMouseEnter={e=>e.currentTarget.style.background=T.paper}
                    onMouseLeave={e=>e.currentTarget.style.background="none"}>
                    <div style={{fontSize:14,fontWeight:500,color:T.ink,marginBottom:2}}>{r.title}</div>
                    <div style={{fontSize:11,color:T.muted}}>{r.tags.slice(0,3).join(" · ")} · 👤 {r.servings}</div>
                  </button>
                ))}
                {filteredPicker.length===0&&<p style={{fontSize:13,color:T.muted,textAlign:"center",padding:"16px 0"}}>No recipes found</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Grocery list overlay */}
      {showGrocery&&(
        <Overlay onClose={()=>{setShowGrocery(false);setSmsStatus("");}}>
          <div className="card fi" style={{width:"100%",maxWidth:500,marginBottom:24,background:T.surface}}>
            <div style={{padding:"14px 18px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <h3 style={{fontFamily:serif,fontSize:18,color:T.ink}}>🛒 Grocery List</h3>
                <p style={{fontSize:11,color:T.muted,marginTop:2}}>
                  {isCustomFilter ? `${(selectedGroceryDays||new Set()).size} day${(selectedGroceryDays||new Set()).size!==1?"s":""} selected — ` : `Auto (${autoGroceryDays.size} day${autoGroceryDays.size!==1?"s":""}) — `}
                  {checkedCount>0?`${checkedCount}/${groceryItems.length} checked`:`${groceryItems.length} item${groceryItems.length!==1?"s":""}`}
                </p>
              </div>
              <div style={{display:"flex",gap:6,alignItems:"center"}}>
                {checkedCount>0&&<button className="bg" style={{fontSize:12,padding:"4px 9px"}} onClick={()=>setCheckedItems({})}>Uncheck all</button>}
                <button className="bg" style={{fontSize:12,padding:"5px 10px"}} onClick={()=>{navigator.clipboard.writeText(groceryText());setCopiedGrocery(true);setTimeout(()=>setCopiedGrocery(false),2000);}}>
                  {copiedGrocery?"✓ Copied!":"Copy all"}
                </button>
                <button className="bg" onClick={()=>{setShowGrocery(false);setSmsStatus("");}}>✕</button>
              </div>
            </div>
            <div style={{padding:"12px 18px"}}>
              {/* Day filter status */}
              <div style={{marginBottom:10,padding:"7px 10px",background:T.paper,borderRadius:7,fontSize:12,color:T.muted,display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:6}}>
                <span>
                  {isCustomFilter
                    ? `${(selectedGroceryDays||new Set()).size} day${(selectedGroceryDays||new Set()).size!==1?"s":""} selected`
                    : `Auto: ${autoGroceryDays.size} day${autoGroceryDays.size!==1?"s":""} with meals`}
                </span>
                <div style={{display:"flex",gap:6}}>
                  {isCustomFilter && <button className="bg" style={{fontSize:11,padding:"2px 8px"}} onClick={resetGroceryFilter}>Reset to auto</button>}
                  {!isCustomFilter && <span style={{fontSize:11,color:T.muted}}>tap 🛒 on days to filter</span>}
                </div>
              </div>
              {groceryItems.length===0
                ? <p style={{color:T.muted,fontSize:13,textAlign:"center",padding:"20px 0"}}>No meals planned. Add recipes to your calendar first.</p>
                : <div style={{marginBottom:14}}>
                    {groceryItems.map((item,i)=>{
                      const checked = !!checkedItems[item.name];
                      return (
                        <div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 0",borderBottom:`1px solid ${T.border}`,cursor:"pointer",opacity:checked?0.45:1,transition:"opacity .15s"}}
                          onClick={()=>toggleCheck(item.name)}>
                          {/* Checkbox */}
                          <div style={{flexShrink:0,marginTop:3,width:16,height:16,borderRadius:4,border:`1.5px solid ${checked?T.terra:T.border}`,background:checked?T.terra:"transparent",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s"}}>
                            {checked&&<span style={{color:"#fff",fontSize:10,fontWeight:700,lineHeight:1}}>✓</span>}
                          </div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:"flex",alignItems:"baseline",gap:8,flexWrap:"wrap"}}>
                              <span style={{fontSize:13,fontWeight:500,color:T.ink,textDecoration:checked?"line-through":"none"}}>{item.name}</span>
                              <span style={{fontSize:13,color:T.terra,fontWeight:500}}>{item.displayAmount}</span>
                            </div>
                            {/* Sub-breakdown — only show when more than 1 recipe contributed */}
                            {item.subLines.length>1&&(
                              <div style={{marginTop:3,display:"flex",flexDirection:"column",gap:1}}>
                                {item.subLines.map((l,li)=>(
                                  <span key={li} style={{fontSize:11,color:T.muted}}>↳ {l}</span>
                                ))}
                              </div>
                            )}
                            {/* Single recipe — show recipe name small */}
                            {item.subLines.length===1&&(
                              <span style={{fontSize:11,color:T.muted}}>{item.subLines[0].split("—").slice(1).join("—").trim()}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
              }

              {groceryItems.length>0&&<div style={{background:T.paper,borderRadius:8,padding:"11px 13px"}}>
                <div style={{fontSize:12,fontWeight:500,color:T.ink,marginBottom:4}}>Send this list as a text</div>
                <p style={{fontSize:11,color:T.muted,marginBottom:9,lineHeight:1.4}}>
                  Opens your phone's own Messages app with the list pre-filled — just pick a contact and tap send.
                </p>
                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                  <a href={`sms:?body=${encodeURIComponent(groceryText())}`} style={{textDecoration:"none"}}>
                    <button className="bp" style={{fontSize:13,padding:"7px 14px"}}>💬 Open in Messages</button>
                  </a>
                  <button className="bg" style={{fontSize:13,padding:"7px 14px"}} onClick={()=>{navigator.clipboard.writeText(groceryText());setSmsStatus("copied");}}>
                    Copy text instead
                  </button>
                </div>
                {smsStatus==="copied"&&<p style={{fontSize:12,color:T.sage,marginTop:6}}>✓ Copied to clipboard!</p>}
              </div>}
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TWILIO INSTRUCTIONS MODAL
// ═══════════════════════════════════════════════════════════════════════════════
function TwilioModal({ onClose, T }) {
  return (
    <Overlay onClose={onClose} zIndex={300}>
      <div className="card fi" style={{width:"100%",maxWidth:560,marginBottom:24,background:T.surface}}>
        <div style={{padding:"14px 20px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <h3 style={{fontFamily:serif,fontSize:18,color:T.ink}}>How to add Twilio SMS</h3>
          <button className="bg" onClick={onClose}>✕</button>
        </div>
        <div style={{padding:"16px 20px",fontSize:13,color:T.ink,lineHeight:1.7}}>
          <p style={{marginBottom:12}}>Because browsers can't make authenticated server calls directly, Twilio SMS requires a small backend. Here's the quickest path:</p>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {[
              ["1. Create a free Twilio account","Go to twilio.com, sign up, and grab a free phone number. Copy your Account SID and Auth Token from the Console Dashboard."],
              ["2. Deploy a tiny serverless function","Use Vercel, Netlify, or Cloudflare Workers. Create a POST endpoint that accepts { to, body } and calls the Twilio Messages API.\n\nExample: const client = twilio(SID, TOKEN); await client.messages.create({ body, from: YOUR_NUMBER, to });"],
              ["3. Replace the Send button logic","In the grocery list, replace the smsStatus preview line with a fetch call to your serverless endpoint, passing { to: phone, body: groceryText() }."],
              ["4. Add CORS headers","Make sure your function allows requests from your app's domain."],
            ].map(([title, body])=>(
              <div key={title} style={{background:T.paper,borderRadius:7,padding:"10px 13px"}}>
                <div style={{fontWeight:500,marginBottom:4,color:T.terra}}>{title}</div>
                <pre style={{fontSize:11,whiteSpace:"pre-wrap",fontFamily:sans,color:T.ink,lineHeight:1.6}}>{body}</pre>
              </div>
            ))}
          </div>
          <p style={{marginTop:14,fontSize:12,color:T.muted}}>The "Open in Messages" button in the grocery list already works without any setup — it opens your phone's native SMS app pre-filled with the list.</p>
        </div>
      </div>
    </Overlay>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ═══════════════════════════════════════════════════════════════════════════════
const DEF_SETTINGS = { weight:"original", volume:"original", temp:"original", weekStart:"sun", dark:"system" };

function useDark(setting) {
  const [sysDark, setSysDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches);
  useEffect(()=>{
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const h = e => setSysDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  },[]);
  if (setting === "dark") return true;
  if (setting === "light") return false;
  return sysDark;
}

export default function App() {
  // user: { id, email, name } once loaded from Supabase, else null
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [trash, setTrash] = useState([]);
  const [mealPlan, setMealPlan] = useState({}); // { [dateKey]: [{recipeId, servings, _entryId}] }
  const [settings, setSettings] = useState(DEF_SETTINGS);
  const [dataLoading, setDataLoading] = useState(false);

  const dark = useDark(settings.dark);
  const T = getTheme(dark);

  const [page, setPage] = useState("recipes");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [importJob, setImportJob] = useState(null);
  const [inbox, setInbox] = useState([]);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [sharedRecipeToImport, setSharedRecipeToImport] = useState(null); // from URL #share=
  const [showSettings, setShowSettings] = useState(false);
  const [showTwilio, setShowTwilio] = useState(false);
  const searchRef = useRef();
  const importJobRef = useRef(null); // stable ref for callbacks inside async fns
  importJobRef.current = importJob;

  // ─── Bootstrap: detect an existing session on load, and pick up new sign-ins ──
  useEffect(() => {
    let handledInitial = false;
    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === "SIGNED_OUT") {
        setUser(null); setRecipes([]); setTrash([]); setMealPlan({}); setInbox([]);
        setSettings(DEF_SETTINGS); setPage("recipes");
        setAuthChecked(true);
        return;
      }
      // INITIAL_SESSION fires once on load (with or without a session).
      // SIGNED_IN fires right after sbVerifyCode() completes signUp/signInWithPassword.
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN") {
        if (session?.user) {
          try {
            const userRow = await sbEnsureUserRow(session.user);
            await loadAllUserData(userRow);
          } catch(e) {
            console.error("Failed to load user after sign-in:", e);
            // Don't strand the user on a spinner -- show the login screen again
          }
        }
        handledInitial = true;
        setAuthChecked(true);
      }
    });
    // Safety net: if no auth event fires within 4s (e.g. offline), stop showing the loader
    const timeout = setTimeout(() => { if (!handledInitial) setAuthChecked(true); }, 4000);
    return () => { sub.subscription.unsubscribe(); clearTimeout(timeout); };
  }, []);

  async function loadAllUserData(userRow) {
    setUser(userRow);
    setDataLoading(true);
    const [r, t, mp, s, ib] = await Promise.all([
      sbLoadRecipes(userRow.id),
      sbLoadTrash(userRow.id),
      sbLoadMealPlan(userRow.id),
      sbLoadSettings(userRow.id),
      sbLoadInbox(userRow.email),
    ]);
    setRecipes(r);
    setTrash(t);
    setMealPlan(mp);
    setSettings(s ? {...DEF_SETTINGS, ...s} : DEF_SETTINGS);
    setInbox(ib);
    setDataLoading(false);
  }

  function login(userRow) {
    loadAllUserData(userRow);
  }
  async function logout() {
    await sbSignOut();
    setUser(null); setRecipes([]); setTrash([]); setMealPlan({}); setInbox([]);
    setSettings(DEF_SETTINGS); setPage("recipes");
  }

  // ─── Recipes ──────────────────────────────────────────────────────────────
  async function addRecipe(r) {
    if (!user) return false;
    try {
      const saved = await sbInsertRecipe(user.id, r);
      setRecipes(prev => [saved, ...prev]);
      return true;
    } catch(e) {
      console.error("addRecipe failed:", e);
      return false;
    }
  }
  async function saveRecipe(r) {
    await sbUpdateRecipe(r);
    setRecipes(prev => prev.map(x => x.id === r.id ? r : x));
    setSelected(r);
  }
  async function deleteRecipe(id) {
    const r = recipes.find(x => x.id === id);
    if (!r) return;
    await sbSoftDeleteRecipe(id);
    setRecipes(prev => prev.filter(x => x.id !== id));
    setTrash(prev => [{...r, deletedAt: new Date()}, ...prev]);
  }
  async function restoreRecipe(id) {
    const r = trash.find(x => x.id === id);
    if (!r) return;
    await sbRestoreRecipe(id);
    const { deletedAt, ...rest } = r;
    setTrash(prev => prev.filter(x => x.id !== id));
    setRecipes(prev => [rest, ...prev]);
  }

  // ─── Shared inbox ─────────────────────────────────────────────────────────
  async function acceptInboxRecipe(msgId) {
    const msg = inbox.find(m => m.id === msgId);
    if (!msg || !user) return;
    const saved = await sbInsertRecipe(user.id, {...msg.recipe, sharedBy: msg.fromName});
    if (saved) setRecipes(prev => [saved, ...prev]);
    await sbDismissInboxItem(msgId);
    setInbox(prev => prev.filter(m => m.id !== msgId));
  }
  async function dismissInboxItem(msgId) {
    await sbDismissInboxItem(msgId);
    setInbox(prev => prev.filter(m => m.id !== msgId));
  }

  // ─── Settings ─────────────────────────────────────────────────────────────
  async function updateSettings(s) {
    setSettings(s);
    if (user) await sbSaveSettings(user.id, s);
  }

  // ─── Meal plan sync (keeps the {dateKey: [...]} shape MealPlanPage expects) ─
  async function onMealPlanChange(newPlan) {
    if (!user) return;
    // Diff against current mealPlan to know what to insert/update/delete
    const prevPlan = mealPlan;
    const allDateKeys = new Set([...Object.keys(prevPlan), ...Object.keys(newPlan)]);
    const updatedPlan = {...newPlan};

    for (const dk of allDateKeys) {
      const prevEntries = prevPlan[dk] || [];
      const newEntries = newPlan[dk] || [];

      // Deleted entries: had an _entryId before, no longer present
      for (const pe of prevEntries) {
        const stillThere = newEntries.find(ne => ne._entryId === pe._entryId);
        if (!stillThere && pe._entryId) {
          await sbDeleteMealEntry(pe._entryId);
        }
      }
      // New or updated entries
      for (let i = 0; i < newEntries.length; i++) {
        const ne = newEntries[i];
        if (!ne._entryId) {
          // Brand new entry — insert and capture the id
          const entryId = await sbAddMealEntry(user.id, dk, ne.recipeId, ne.servings);
          updatedPlan[dk] = updatedPlan[dk].map((x,idx) => idx===i ? {...x, _entryId: entryId} : x);
        } else {
          const prevMatch = prevEntries.find(pe => pe._entryId === ne._entryId);
          if (prevMatch && prevMatch.servings !== ne.servings) {
            await sbUpdateMealEntry(ne._entryId, ne.servings);
          }
        }
      }
    }
    setMealPlan(updatedPlan);
  }

  // ─── Recipe import (Groq via myrecipecards-api serverless function) ────────
  async function runImport(action) {
    if (action.type === "reset") { setImportJob(null); return; }
    if (action.type === "save") {
      const job = importJobRef.current;
      if (job?.parsed) {
        setImportJob(j => ({...j, loading:true, error:"", label:"Saving recipe\u2026"}));
        const ok = await addRecipe({...job.parsed, image: job.capturedImage || null});
        if (ok) {
          setImportJob(null); setShowAdd(false);
        } else {
          setImportJob(j => ({...j, loading:false, label:"", error:"Couldn\'t save the recipe. Please try again."}));
        }
      }
      return;
    }
    if (action.type === "error") { setImportJob(prev => ({...prev, loading:false, error:action.error})); return; }

    setShowAdd(true);
    let userContent = null;
    let capturedImage = null;
    let hasImage = false;

    try {
      if (action.type === "url") {
        const text = action.text.trim();
        const isUrl = /^https?:\/\//i.test(text);
        if (isUrl) {
          setImportJob({ loading:true, step:"Fetching", label:"Fetching page\u2026", parsed:null, error:"", capturedImage:null });
          try {
            const resp = await fetch(`https://r.jina.ai/${text}`, {
              headers:{ "Accept":"text/plain" },
              signal: AbortSignal.timeout(14000)
            });
            if (!resp.ok) throw new Error("status "+resp.status);
            const jinaImgHeader = resp.headers.get("x-image-url") || resp.headers.get("X-Image-Url");
            const pageText = (await resp.text()).slice(0, 12000);
            const imgMatch = pageText.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]{10,400})\)/i);
            const imgUrl = jinaImgHeader || (imgMatch ? imgMatch[1] : null);
            if (imgUrl) capturedImage = imgUrl;
            userContent = "Extract the recipe from this page content. Return ONLY the JSON, nothing else.\n\n" + pageText;
          } catch(_) {
            userContent = "Extract the recipe from this URL. You may know this site \u2014 return the recipe as JSON.\n\nURL: " + text;
          }
        } else {
          userContent = "Extract the recipe from this text:\n\n" + text;
        }
      } else if (action.type === "photo") {
        capturedImage = action.imgSrc;
        hasImage = true;
        userContent = [
          { type:"text", text:"Extract the recipe from this photo. Return ONLY the JSON." },
          { type:"image_url", image_url:{ url: action.imgSrc } },
        ];
      } else if (action.type === "parts") {
        capturedImage = action.imgSrc || null;
        const imgBlock = action.parts.find(p => p.type === "image");
        const textBlocks = action.parts.filter(p => p.type === "text" || p.type === "document").map(p => p.text || "(document attached — describe what you can infer)");
        if (imgBlock) {
          hasImage = true;
          userContent = [
            { type:"text", text: textBlocks.join("\n") || "Extract the recipe from this photo. Return ONLY the JSON." },
            { type:"image_url", image_url:{ url: `data:${imgBlock.source.media_type};base64,${imgBlock.source.data}` } },
          ];
        } else {
          userContent = textBlocks.join("\n") || "Extract the recipe.";
        }
      } else if (action.type === "manual") {
        const m = action.manual;
        userContent =
          "Standardize this recipe and return ONLY valid JSON:\n\n" +
          "Title:" + m.title + "\n" +
          "Desc:" + m.description + "\n" +
          "Prep:" + m.prepTime + "\n" +
          "Cook:" + m.cookTime + "\n" +
          "Serves:" + m.servings + "\n" +
          "Tags:" + m.tags + "\n" +
          "Notes:" + m.notes + "\n" +
          "Ingredients:\n" + m.ingredients + "\n" +
          "Steps:\n" + m.steps;
      } else return;

      setImportJob(j=>({...(j||{}), loading:true, step:"Extracting", label:"Sending to Groq\u2026", parsed:null, error:"", capturedImage}));
      const res = await fetch("https://myrecipecards-api.vercel.app/api/extract-recipe", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ system: SYS, userContent, hasImage }),
      });

      setImportJob(j=>({...j, step:"Parsing", label:"Parsing result\u2026"}));
      const d = await res.json();
      if (d.error) {
        const m = typeof d.error === "string" ? d.error : (d.error.message || JSON.stringify(d.error));
        throw new Error(m);
      }
      const raw = d.choices?.[0]?.message?.content || "";
      const jsonMatch = raw.match(/{[\s\S]*}/);
      if (!jsonMatch) throw new Error("No JSON found in response");
      const parsed = JSON.parse(jsonMatch[0]);
      if (!capturedImage && parsed.imageUrl && /^https?:\/\//.test(parsed.imageUrl)) {
        capturedImage = parsed.imageUrl;
      }
      delete parsed.imageUrl;
      const SPLITS=[["salt and black pepper","salt","black pepper"],["salt and white pepper","salt","white pepper"],["salt and pepper","salt","pepper"],["pepper and salt","pepper","salt"],["oil and salt","oil","salt"],["sugar and salt","sugar","salt"]];
      parsed.ingredients = (parsed.ingredients||[]).flatMap(ing=>{ const low=(ing.name||"").toLowerCase(); const hit=SPLITS.find(([c])=>low.includes(c)); return hit?[{amount:ing.amount||"to taste",name:hit[1]},{amount:ing.amount||"to taste",name:hit[2]}]:[ing]; });
      const EQUIP2=[{tag:"air-fryer",w:["air fry","air-fry"]},{tag:"oven",w:["oven","bake","roast","broil","preheat"]},{tag:"frying-pan",w:["frying pan","skillet","saute","sauté","sear"]},{tag:"pot",w:["large pot","stockpot","boil"]},{tag:"blender",w:["blender","blend until"]},{tag:"instant-pot",w:["instant pot","pressure cook"]},{tag:"slow-cooker",w:["slow cooker","crockpot"]},{tag:"grill",w:["grill","barbecue"]},{tag:"microwave",w:["microwave"]}];
      const stepsText2=(parsed.steps||[]).join(" ").toLowerCase();
      const equipTags=EQUIP2.filter(e=>e.w.some(w=>stepsText2.includes(w))).map(e=>e.tag);
      parsed.tags=[...new Set([...(parsed.tags||[]),...equipTags])];
      setImportJob(j=>({...j, loading:false, step:"Done", label:"Recipe ready!", parsed, capturedImage: j?.capturedImage || capturedImage}));

    } catch(e) {
      console.error("Import error:", e);
      setImportJob(j=>({...(j||{}), loading:false, step:"", label:"", error:`Import failed: ${e.message}. For URLs, try pasting the recipe text directly instead.`}));
    }
  }

  // ─── Shared-via-link detection ───────────────────────────────────────────
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#share=")) {
      const r = decodeShareLink(hash);
      if (r) setSharedRecipeToImport(r);
      window.history.replaceState(null,"",window.location.pathname);
    }
  }, []);

  const hasSettings = settings.weight!=="original"||settings.volume!=="original"||settings.temp!=="original"||settings.dark!=="system"||settings.weekStart!=="sun";

  function allTags() {
    const c={};
    recipes.forEach(r=>r.tags.forEach(t=>{c[t]=(c[t]||0)+1;}));
    return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,14).map(([t])=>t);
  }
  function matchRecipe(r) {
    const q=search.toLowerCase();
    const ing=r.ingredients.map(i=>`${i.amount} ${i.name}`).join(" ").toLowerCase();
    const searchOk=!q||r.title.toLowerCase().includes(q)||r.description?.toLowerCase().includes(q)||ing.includes(q)||r.tags.join(" ").toLowerCase().includes(q);
    const filtersOk=filters.every(f=>{const fl=f.toLowerCase();return r.title.toLowerCase().includes(fl)||r.tags.some(t=>t.includes(fl))||ing.includes(fl);});
    return searchOk&&filtersOk;
  }
  const filtered = recipes.filter(matchRecipe);
  function addFilter(f) { const c=f.trim().toLowerCase();if(c&&!filters.includes(c))setFilters([...filters,c]); }
  function onSearchKey(e) { if(e.key==="Enter"&&search.trim()){addFilter(search.trim());setSearch("");} }

  const css = makeCSS(T);

  if (!authChecked) {
    return (
      <>
        <style>{css}</style>
        <div style={{minHeight:"100vh",background:T.bg,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <Dots/>
        </div>
      </>
    );
  }

  if (!user) return (<><style>{css}</style><AuthScreen T={T} onLogin={login}/></>);

  const uid = user.email; // used as the identity key throughout the UI (sharing, ownership labels, etc.)
  const userName = user.name || user.email;

  return (
    <>
      <style>{css}</style>
      <div style={{minHeight:"100vh",background:T.bg}}>
        {/* Header */}
        <header style={{background:T.surface,borderBottom:`1px solid ${T.border}`,padding:"0 18px",position:"sticky",top:0,zIndex:30}}>
          <div style={{maxWidth:1100,margin:"0 auto",display:"flex",alignItems:"center",justifyContent:"space-between",height:52}}>
            <div style={{display:"flex",alignItems:"center"}}>
              <h1 style={{fontFamily:serif,fontSize:19,fontWeight:600,marginRight:18}}>
                <span style={{color:T.muted}}>my</span><span style={{color:T.terra}}>recipe</span><span style={{color:T.sage}}>cards</span>
              </h1>
              <nav style={{display:"flex"}}>
                <button className={`nav-btn${page==="recipes"?" active":""}`} onClick={()=>setPage("recipes")}>Recipes</button>
                <button className={`nav-btn${page==="mealplan"?" active":""}`} onClick={()=>setPage("mealplan")}>Meal Plan</button>
              </nav>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:12,color:T.muted,display:"none"}}>{userName}</span>
              {inbox.length>0&&(
                <button className="bg" onClick={()=>setInboxOpen(o=>!o)} style={{position:"relative",padding:"6px 11px",fontSize:12}}>
                  🔔 {inbox.length}
                  <span style={{width:7,height:7,borderRadius:"50%",background:T.terra,position:"absolute",top:2,right:2,border:`2px solid ${T.surface}`}}/>
                </button>
              )}
              <button className="bg" onClick={()=>setShowSettings(true)} style={{position:"relative",padding:"6px 11px",fontSize:12}}>
                ⚙ Settings
                {hasSettings&&<span style={{width:5,height:5,borderRadius:"50%",background:T.terra,position:"absolute",top:3,right:3}}/>}
              </button>
              <button className="bp" onClick={()=>setShowAdd(true)} style={{padding:"6px 12px",fontSize:13}}>+ Add recipe</button>
              <button className="bg" onClick={logout} style={{fontSize:12,padding:"6px 10px"}}>Log out</button>
            </div>
          </div>
        </header>

        {/* Shared-via-link import banner */}
        {sharedRecipeToImport&&(
          <div style={{background:T.terraBtn,color:"#fff",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
            <span style={{fontSize:13,fontWeight:500}}>📨 Someone shared "<strong>{sharedRecipeToImport.title}</strong>" with you</span>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>{addRecipe(sharedRecipeToImport);setSharedRecipeToImport(null);}}
                style={{background:"#fff",color:T.terraBtn,border:"none",borderRadius:6,padding:"5px 14px",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:sans}}>
                Add to my cookbook
              </button>
              <button onClick={()=>setSharedRecipeToImport(null)}
                style={{background:"rgba(255,255,255,0.2)",color:"#fff",border:"none",borderRadius:6,padding:"5px 10px",fontSize:12,cursor:"pointer",fontFamily:sans}}>
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Inbox dropdown */}
        {inboxOpen&&inbox.length>0&&(
          <div style={{position:"fixed",top:54,right:16,zIndex:80,width:340,maxHeight:420,overflowY:"auto",background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,boxShadow:"0 8px 28px rgba(0,0,0,.15)"}}>
            <div style={{padding:"10px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:13,fontWeight:500,color:T.ink}}>Shared with you</span>
              <button className="bg" style={{fontSize:11,padding:"2px 8px"}} onClick={()=>setInboxOpen(false)}>✕</button>
            </div>
            {inbox.map(msg=>(
              <div key={msg.id} style={{padding:"10px 16px",borderBottom:`1px solid ${T.border}`,display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:500,color:T.ink,marginBottom:2}}>{msg.recipe.title}</div>
                  <div style={{fontSize:11,color:T.muted}}>From {msg.fromName} · {new Date(msg.sentAt).toLocaleDateString()}</div>
                </div>
                <div style={{display:"flex",gap:5,flexShrink:0}}>
                  <button className="bp" style={{padding:"4px 10px",fontSize:11}} onClick={()=>{acceptInboxRecipe(msg.id);setInboxOpen(false);}}>Add</button>
                  <button className="bg" style={{padding:"4px 8px",fontSize:11}} onClick={()=>dismissInboxItem(msg.id)}>✕</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recipes Page */}
        {page==="recipes"&&(
          <main style={{maxWidth:1100,margin:"0 auto",padding:"20px 18px"}}>
            <div style={{marginBottom:9,position:"relative"}}>
              <input ref={searchRef} placeholder="Search ingredients, dish name, cuisine..." value={search}
                onChange={e=>setSearch(e.target.value)} onKeyDown={onSearchKey}
                style={{width:"100%",fontSize:15,paddingRight:search?"34px":"12px",background:T.surface,color:T.ink}}/>
              {search&&<button onClick={()=>{setSearch("");searchRef.current?.focus();}}
                style={{position:"absolute",right:9,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer",fontSize:15,color:T.muted,padding:0}}>✕</button>}
            </div>
            {filters.length>0&&(
              <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap",marginBottom:9}}>
                {filters.map(f=>(
                  <button key={f} onClick={()=>setFilters(filters.filter(a=>a!==f))}
                    style={{display:"inline-flex",alignItems:"center",gap:3,padding:"3px 9px",borderRadius:20,border:`1px solid ${T.terra}`,background:T.terraLight,color:T.terra,fontSize:12,cursor:"pointer",fontFamily:sans}}>
                    {f}<span>×</span>
                  </button>
                ))}
                <button onClick={()=>setFilters([])} style={{fontSize:11,color:T.muted,background:"none",border:"none",cursor:"pointer"}}>clear all</button>
              </div>
            )}
            {!search&&!filters.length&&(
              <div style={{display:"flex",gap:5,flexWrap:"wrap",marginBottom:16}}>
                {allTags().map(t=><button key={t} className="tag" onClick={()=>addFilter(t)} style={{cursor:"pointer",border:"none",fontFamily:sans}}>{t}</button>)}
              </div>
            )}
            {(search||filters.length>0)&&(
              <p style={{fontSize:12,color:T.muted,marginBottom:12}}>
                {filtered.length} recipe{filtered.length!==1?"s":""} found
                {search&&<> matching "<strong>{search}</strong>"</>}
                {filters.length>0&&<> · {filters.map((f,i)=><span key={f}><strong>{f}</strong>{i<filters.length-1?" + ":""}</span>)}</>}
              </p>
            )}
            {filtered.length>0
              ? <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:13}}>
                  {filtered.map(r=><RecipeCard key={r.id} recipe={r} onClick={setSelected} T={T}/>)}
                </div>
              : <div style={{textAlign:"center",padding:"48px 20px",color:T.muted}}>
                  <div style={{fontSize:34,marginBottom:9}}>🍽️</div>
                  <p style={{fontFamily:serif,fontSize:16,marginBottom:5,color:T.ink}}>No recipes found</p>
                  <p style={{fontSize:13}}>Try a different search or add a new recipe</p>
                  <button className="bp" style={{marginTop:13}} onClick={()=>setShowAdd(true)}>Add your first recipe</button>
                </div>
            }
          </main>
        )}

        {/* Meal Plan Page */}
        {page==="mealplan"&&(
          <MealPlanPage
            recipes={recipes}
            mealPlan={mealPlan}
            onMealPlanChange={onMealPlanChange}
            settings={settings}
            T={T}
          />
        )}
      </div>

      {selected&&<RecipeDetail recipe={selected} settings={settings} T={T} currentUid={uid} currentName={userName} onClose={()=>setSelected(null)} onDelete={id=>{deleteRecipe(id);setSelected(null);}} onSave={saveRecipe}/>}

      {/* AddModal — always mounts when showAdd, importJob persists in App even when modal is hidden */}
      {showAdd&&<AddModal
        onClose={()=>setShowAdd(false)}
        T={T}
        importJob={importJob}
        onStartImport={runImport}
      />}

      {/* Toast — shows when there is an active import job AND modal is not open */}
      {importJob&&!showAdd&&(
        <ImportToast
          importJob={importJob}
          T={T}
          onExpand={()=>setShowAdd(true)}
        />
      )}

      {showSettings&&<SettingsModal settings={settings} onChange={updateSettings} onClose={()=>setShowSettings(false)} trash={trash} onRestore={restoreRecipe} T={T}/>}
      {showTwilio&&<TwilioModal onClose={()=>setShowTwilio(false)} T={T}/>}
    </>
  );
}
