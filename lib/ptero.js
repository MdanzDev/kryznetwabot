// ptero.js — Pterodactyl panel API wrapper
// Admin key (ptlc) for panel management: create/delete users, servers, nodes
// User JWT from .login for client actions: list servers, power control
// User client API keys (ptla) for direct server control

const axios = require("axios");

const BASE = "https://panel.kryz-net.space/api";
const PANEL_URL = "https://panel.kryz-net.space";
const ADMIN_KEY = "ptlc_tLraq3GfacKijhWf5ALkBNoP58D6t2EU2rAjzEQfNMH";

const headers = (token) => ({ Authorization: `Bearer ${token}`, Accept: "application/json" });
const clientHeaders = (jwt) => ({ Authorization: `Bearer ${jwt}`, Accept: "application/json" });

// ---- AUTH: user login via email+password → JWT ----
async function login(email, password) {
    const r = await axios.post(`${PANEL_URL}/api/client/login`, {
        email, password
    }, { headers: { Accept: "application/json" }, timeout: 15000, validateStatus: () => true });
    if (r.status !== 200) throw new Error(r.data?.errors?.[0]?.detail || `Login failed (${r.status})`);
    return r.data.data?.attributes?.token || r.data?.token || r.data?.data?.token;
}

// Create a client API key for the logged-in user (persist for later use)
async function createClientApiKey(jwt, description) {
    const r = await axios.post(`${BASE}/client/api-keys`, {
        description: description || "Bot WhatsApp",
        allowed_ips: null
    }, { headers: clientHeaders(jwt), timeout: 15000, validateStatus: () => true });
    if (r.status !== 200 && r.status !== 201) throw new Error(r.data?.errors?.[0]?.detail || `Key creation failed (${r.status})`);
    return { identifier: r.data?.data?.attributes?.identifier, token: r.data?.data?.meta?.secret_token };
}

// ---- CLIENT: list user's servers (needs client API key or JWT) ----
async function listClientServers(clientKey) {
    const r = await axios.get(`${BASE}/client`, { headers: headers(clientKey), timeout: 15000, validateStatus: () => true });
    if (r.status !== 200) throw new Error(r.data?.errors?.[0]?.detail || `Failed (${r.status})`);
    return (r.data?.data || []).map(s => ({
        id: s.attributes.uuid,
        identifier: s.attributes.identifier,
        name: s.attributes.name,
        description: s.attributes.description,
        suspended: s.attributes.suspended,
        limits: s.attributes.limits,
        relationships: s.attributes.relationships
    }));
}

// Get server power state
async function getServerState(clientKey, serverId) {
    const r = await axios.get(`${BASE}/client/servers/${serverId}/resources`, {
        headers: headers(clientKey), timeout: 15000, validateStatus: () => true
    });
    if (r.status !== 200) return { state: "unknown", status: r.status };
    const a = r.data?.attributes;
    return { state: a?.current_state, cpu: a?.resource_utilization?.cpu, ram: a?.resource_utilization?.memory, disk: a?.resource_utilization?.disk };
}

// Power control: start/stop/restart/kill
async function powerAction(clientKey, serverId, action) {
    const valid = ["start", "stop", "restart", "kill"];
    if (!valid.includes(action)) throw new Error(`Invalid action: ${action}. Use: ${valid.join(", ")}`);
    const r = await axios.post(`${BASE}/client/servers/${serverId}/power`, { signal: action }, {
        headers: headers(clientKey), timeout: 15000, validateStatus: () => true
    });
    if (r.status !== 204 && r.status !== 200) throw new Error(r.data?.errors?.[0]?.detail || `Power action failed (${r.status})`);
    return true;
}

// ---- ADMIN: list all users ----
async function listUsers() {
    const r = await axios.get(`${BASE}/application/users?per_page=100`, { headers: headers(ADMIN_KEY), timeout: 15000, validateStatus: () => true });
    if (r.status !== 200) throw new Error(r.data?.errors?.[0]?.detail || `Failed (${r.status})`);
    return (r.data?.data || []).map(u => ({
        id: u.attributes.id, email: u.attributes.email,
        name: `${u.attributes.first_name} ${u.attributes.last_name}`.trim(),
        admin: u.attributes.root_admin, suspended: u.attributes.server_owner
    }));
}

// ---- ADMIN: create user ----
async function createUser(email, username, firstName, lastName, password) {
    const r = await axios.post(`${BASE}/application/users`, {
        email, username, first_name: firstName, last_name: lastName || "", password: password || undefined
    }, { headers: headers(ADMIN_KEY), timeout: 15000, validateStatus: () => true });
    if (r.status !== 200 && r.status !== 201) throw new Error(r.data?.errors?.[0]?.detail || `Create failed (${r.status})`);
    return { id: r.data?.attributes?.id, email: r.data?.attributes?.email };
}

// ---- ADMIN: delete user ----
async function deleteUser(userId) {
    const r = await axios.delete(`${BASE}/application/users/${userId}`, { headers: headers(ADMIN_KEY), timeout: 15000, validateStatus: () => true });
    if (r.status !== 204) throw new Error(r.data?.errors?.[0]?.detail || `Delete failed (${r.status})`);
    return true;
}

// ---- ADMIN: list all servers ----
async function listServers() {
    const r = await axios.get(`${BASE}/application/servers?per_page=100`, { headers: headers(ADMIN_KEY), timeout: 15000, validateStatus: () => true });
    if (r.status !== 200) throw new Error(r.data?.errors?.[0]?.detail || `Failed (${r.status})`);
    return (r.data?.data || []).map(s => ({
        id: s.attributes.id, name: s.attributes.name, uuid: s.attributes.uuid,
        node: s.attributes.node, egg: s.attributes.egg, owner_id: s.attributes.owner_id,
        limits: s.attributes.limits
    }));
}

// ---- ADMIN: create server ----
async function createServer(name, ownerId, eggId, nodeId, memory, disk, cpu, port) {
    const r = await axios.post(`${BASE}/application/servers`, {
        name, user: ownerId, egg: eggId,
        docker_image: "ghcr.io/pterodactyl/yolks:node_18",
        startup: "node index.js",
        environment: { STARTUP_CMD: "node index.js" },
        limits: { memory: memory || 1024, disk: disk || 2048, cpu: cpu || 100 },
        feature_limits: { databases: 1, allocations: 1, backups: 1 },
        allocation: { default: true }
    }, { headers: headers(ADMIN_KEY), timeout: 30000, validateStatus: () => true });
    if (r.status !== 200 && r.status !== 201) throw new Error(JSON.stringify(r.data?.errors || r.data).slice(0, 200));
    return { id: r.data?.attributes?.id, name: r.data?.attributes?.name, uuid: r.data?.attributes?.uuid };
}

// ---- ADMIN: delete server ----
async function deleteServer(serverId, force = false) {
    const r = await axios.delete(`${BASE}/application/servers/${serverId}${force ? "/force" : ""}`, {
        headers: headers(ADMIN_KEY), timeout: 15000, validateStatus: () => true
    });
    if (r.status !== 204) throw new Error(r.data?.errors?.[0]?.detail || `Delete failed (${r.status})`);
    return true;
}

// ---- ADMIN: list nodes ----
async function listNodes() {
    const r = await axios.get(`${BASE}/application/nodes?per_page=100`, { headers: headers(ADMIN_KEY), timeout: 15000, validateStatus: () => true });
    if (r.status !== 200) throw new Error(r.data?.errors?.[0]?.detail || `Failed (${r.status})`);
    return (r.data?.data || []).map(n => ({
        id: n.attributes.id, name: n.attributes.name, fqdn: n.attributes.fqdn,
        memory: n.attributes.memory, memory_overallocate: n.attributes.memory_overallocate,
        disk: n.attributes.disk, daemon_listen: n.attributes.daemon_listen
    }));
}

// ---- ADMIN: get user by email ----
async function getUserByEmail(email) {
    const users = await listUsers();
    return users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

module.exports = {
    login, createClientApiKey,
    listClientServers, getServerState, powerAction,
    listUsers, createUser, deleteUser,
    listServers, createServer, deleteServer,
    listNodes, getUserByEmail,
    PANEL_URL
};
