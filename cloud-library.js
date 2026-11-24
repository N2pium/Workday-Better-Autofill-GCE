/*
 * Answer Library matching (plan/Features/F11 Answer Library.md).
 *
 * Cheapest first: keyword rules pick a category for free; only when no rule
 * matches does the caller ask the API's tiny categoriser. Saved answers in the
 * category are then ranked: fits the character limit, then most used, then
 * most recent. "Use as-is" fills {company} and {role} locally, with no AI call.
 *
 * Pure functions only (no chrome.* or DOM), so the content script, the side
 * panel and the tests share one copy.
 */
(function (global) {
    'use strict';

    const CATEGORIES = [
        'why-company', 'why-role', 'challenge', 'leadership', 'teamwork', 'conflict',
        'strength', 'weakness', 'career-goals', 'custom'
    ];

    const LABELS = {
        'why-company': 'Why this company', 'why-role': 'Why this role', challenge: 'A challenge',
        leadership: 'Leadership', teamwork: 'Teamwork', conflict: 'Conflict', strength: 'Strengths',
        weakness: 'Weaknesses', 'career-goals': 'Career goals', custom: 'Other'
    };

    const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
    const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Order matters: the first rule that matches wins, most specific first.
    const RULES = [
        ['weakness', /\b(weakness|weaknesses|area(s)? (for|of) (improvement|growth)|improve on)\b/],
        ['strength', /\b(strength|strengths|what makes you (a )?(good|great|strong)|why should we hire)\b/],
        ['conflict', /\b(conflict|disagree(d|ment)?|difficult (co-?worker|colleague|person|team ?mate|customer))\b/],
        ['leadership', /\b(led|lead(ing)?|leader(ship)?|took (the )?initiative|mentor(ed)?)\b/],
        ['teamwork', /\b(team ?work|work(ed)? (in|on|with) a team|collaborat(e|ed|ion)|cross-functional)\b/],
        ['challenge', /\b(challeng(e|ing)|obstacle|overc(a|o)me|setback|fail(ed|ure)|mistake|problem you solved|difficult (situation|project|problem))\b/],
        ['career-goals', /\b(career (goals?|aspirations?|plans?)|five years|5 years|long-term goals?|where do you see yourself)\b/],
        ['why-role', /\b(why (are you )?(interested in|applying (for|to)|do you want) (this|the) (role|position|job|opportunity|internship)|interest(s|ed)? you (about|in) (this|the) (role|position))\b/],
        ['why-company', /\b(why (do you want to |would you like to )?(work|join|apply)( (at|for|with|to))?|why (us|our company|this company)|what (interests|attracts|draws) you (to|about) (us|our|this company)|interest(ed)? in (working (at|for) )?(us|our company))\b/]
    ];

    /** A category from keyword rules, or null when the caller should ask the categoriser. */
    function categoriseByRules(question, company) {
        const q = norm(question);
        if (!q) return null;
        if (company) {
            const c = norm(company);
            // "Why <Company>?" / "Why do you want to work at <Company>?"
            if (c && new RegExp(`\\bwhy\\b.*\\b${escape(c)}\\b`).test(q)) return 'why-company';
        }
        for (const [category, re] of RULES) if (re.test(q)) return category;
        return null;
    }

    /**
     * Saved answers worth offering for a question, best first. `maxChars` is the
     * box's limit (0 = none). Answers in the category come first; answers that
     * don't fit the limit are kept but ranked last (they can still be adapted).
     */
    function rankAnswers(answers, { category, maxChars = 0, limit = 3 } = {}) {
        const fits = (a) => !maxChars || (a.charCount || String(a.text || '').length) <= maxChars;
        const time = (a) => Date.parse(a.lastUsedAt || a.updatedAt || a.createdAt || 0) || 0;
        return (answers || [])
            .filter((a) => a && a.text && (!category || a.category === category))
            .sort((a, b) => (fits(b) - fits(a)) || ((b.uses || 0) - (a.uses || 0)) || (time(b) - time(a)))
            .slice(0, limit);
    }

    /** {company} / {role} placeholders, filled locally. Unknown values leave the placeholder for the user to see. */
    function fillPlaceholders(text, { company, role } = {}) {
        return String(text || '')
            .replace(/\{company\}/gi, (m) => company || m)
            .replace(/\{role\}/gi, (m) => role || m);
    }

    /** Turns a specific answer back into a reusable one: the company and role names become placeholders. */
    function toTemplate(text, { company, role } = {}) {
        let out = String(text || '');
        const swap = (value, placeholder) => {
            const v = String(value || '').trim();
            if (v.length >= 2) out = out.replace(new RegExp(`\\b${escape(v)}\\b`, 'gi'), placeholder);
        };
        swap(role, '{role}');
        swap(company, '{company}');
        return out;
    }

    /** A stable key for caching a question's category. */
    function questionKey(question) {
        const q = norm(question).replace(/[^a-z0-9 ]/g, '').slice(0, 200);
        let h = 0;
        for (let i = 0; i < q.length; i++) h = (Math.imul(31, h) + q.charCodeAt(i)) | 0;
        return `q${(h >>> 0).toString(36)}`;
    }

    global.EasyApplyLibrary = Object.freeze({
        CATEGORIES, LABELS, categoriseByRules, rankAnswers, fillPlaceholders, toTemplate, questionKey
    });
})(typeof self !== 'undefined' ? self : globalThis);
