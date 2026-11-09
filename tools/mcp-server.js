#!/usr/bin/env node
'use strict';

/* Minimal zero-dependency MCP server (stdio, JSON-RPC 2.0, one JSON message
 * per line). Implements initialize, tools/list, tools/call and ping against
 * tools/manifest.json + tools/shared/compute.js.
 *
 * stdout carries JSON-RPC frames only; all diagnostics go to stderr.
 */

const path = require('path');
const readline = require('readline');
const manifest = require(path.join(__dirname, 'manifest.json'));
const compute = require(path.join(__dirname, 'shared', 'compute.js'));

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_INFO = { name: 'hhfa008-tools', version: '1.0.0' };

function log() {
  const args = Array.prototype.slice.call(arguments);
  process.stderr.write('[mcp-tools] ' + args.join(' ') + '\n');
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function respond(id, result) {
  send({ jsonrpc: '2.0', id: id, result: result });
}

function respondError(id, code, message, data) {
  const error = { code: code, message: message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: '2.0', id: id, error: error });
}

function jsonType(type) {
  if (type === 'string|number') return { anyOf: [{ type: 'string' }, { type: 'number' }] };
  if (type === 'array|string') return { anyOf: [{ type: 'array' }, { type: 'string' }] };
  if (type === 'array') return { type: 'array', items: {} };
  return { type: type };
}

function inputSchema(tool) {
  const properties = {};
  const required = [];
  (tool.inputs || []).forEach(input => {
    const prop = jsonType(input.type);
    if (input.enum) prop.enum = input.enum.slice();
    if (input.min != null) prop.minimum = input.min;
    if (input.max != null) prop.maximum = input.max;
    if (input.default !== undefined) prop.default = input.default;
    const notes = [];
    if (input.unit) notes.push('unit: ' + input.unit);
    if (input.description) notes.push(input.description);
    if (notes.length) prop.description = notes.join('; ');
    properties[input.name] = prop;
    if (input.required) required.push(input.name);
  });
  const schema = { type: 'object', properties: properties };
  if (required.length) schema.required = required;
  return schema;
}

function toolDescriptor(tool) {
  const title = tool.title && tool.title.zh ? tool.title.zh : tool.id;
  let description;
  if (tool.implemented) {
    description = title + ' — ' + tool.summary + ' (page: ' + tool.page + ')';
  } else {
    description = '[not implemented] ' + title + ' — ' + tool.blockedBy + ' (page: ' + tool.page + ')';
  }
  return {
    name: tool.id,
    description: description,
    inputSchema: inputSchema(tool)
  };
}

function findTool(name) {
  return manifest.tools.find(t => t.id === name) || null;
}

async function callTool(name, args) {
  const tool = findTool(name);
  if (!tool) {
    return { isError: true, text: { ok: false, error: 'unknown tool: ' + name } };
  }
  if (!tool.implemented) {
    return {
      isError: true,
      text: { ok: false, error: 'tool is not implemented in the compute core', tool: name, blockedBy: tool.blockedBy }
    };
  }
  if (args == null) args = {};
  if (typeof args !== 'object' || Array.isArray(args)) {
    return { isError: true, text: { ok: false, error: 'arguments must be a JSON object', tool: name } };
  }
  const result = await Promise.resolve(compute.run(name, args));
  if (!result.ok) {
    return { isError: true, text: { ok: false, error: result.error, code: result.code, tool: name } };
  }
  return { isError: false, text: { ok: true, tool: name, result: result.result } };
}

async function handle(msg) {
  if (msg == null || typeof msg !== 'object' || Array.isArray(msg)) {
    respondError(null, -32600, 'Invalid Request');
    return;
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');
  const id = hasId ? msg.id : null;
  const method = msg.method;

  if (typeof method !== 'string') {
    if (hasId) respondError(id, -32600, 'Invalid Request');
    return;
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    log('client initialized');
    return;
  }

  if (method === 'initialize') {
    respond(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions: 'tools/list returns all 100 manifest entries; 35 are implemented and callable. tools/call returns {"ok":true,"tool":...,"result":...} as text; non-implemented tools return isError=true with blockedBy.'
    });
    return;
  }

  if (method === 'ping') {
    respond(id, {});
    return;
  }

  if (method === 'tools/list') {
    const tools = manifest.tools.map(toolDescriptor);
    respond(id, { tools: tools });
    return;
  }

  if (method === 'tools/call') {
    const params = msg.params || {};
    const name = params.name;
    if (typeof name !== 'string') {
      respondError(id, -32602, 'Invalid params: name is required');
      return;
    }
    const out = await callTool(name, params.arguments);
    respond(id, { content: [{ type: 'text', text: JSON.stringify(out.text) }], isError: out.isError });
    return;
  }

  if (hasId) respondError(id, -32601, 'Method not found: ' + method);
}

function main() {
  log('starting, tools=' + manifest.toolCount + ', implemented=' + manifest.implementedCount);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', line => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch (e) {
      log('parse error: ' + e.message);
      respondError(null, -32700, 'Parse error');
      return;
    }
    if (Array.isArray(msg)) {
      respondError(null, -32600, 'Batch requests are not supported');
      return;
    }
    Promise.resolve(handle(msg)).catch(e => {
      log('handler error: ' + (e && e.stack ? e.stack : String(e)));
    });
  });
  rl.on('close', () => { log('stdin closed'); });
}

main();
