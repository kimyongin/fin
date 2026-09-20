const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'accept, content-type, mcp-protocol-version, mcp-session-id',
  'Access-Control-Expose-Headers': 'MCP-Protocol-Version',
}

const supportedProtocolVersions = new Set(['2025-06-18', '2025-03-26', '2024-11-05'])
const defaultProtocolVersion = '2025-06-18'

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
}

function jsonResponse(body: unknown, status = 200, protocolVersion = defaultProtocolVersion) {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders,
      'MCP-Protocol-Version': protocolVersion,
    },
  })
}

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown, protocolVersion?: string) {
  return jsonResponse({ jsonrpc: '2.0', id: id ?? null, result }, 200, protocolVersion)
}

function jsonRpcError(id: JsonRpcId | undefined, code: number, message: string) {
  return jsonResponse({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message },
  })
}

function negotiatedProtocolVersion(requestedVersion: unknown) {
  const version = typeof requestedVersion === 'string' ? requestedVersion : ''
  return supportedProtocolVersions.has(version) ? version : defaultProtocolVersion
}

function toolDefinitions() {
  return [
    {
      name: 'ping',
      title: 'Check portfolio connection',
      description: 'Confirm that ChatGPT can reach the portfolio MCP probe. This tool never reads or changes portfolio data.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          service: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['ok', 'service', 'message'],
        additionalProperties: false,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
  ]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }

  if (req.method === 'GET') {
    return jsonResponse({
      name: 'portfolio-chatgpt-probe',
      status: 'ok',
      protocolVersion: defaultProtocolVersion,
      privateDataExposed: false,
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { ...corsHeaders, Allow: 'GET, POST, OPTIONS' },
    })
  }

  let message: JsonRpcRequest
  try {
    message = await req.json()
  } catch {
    return jsonRpcError(null, -32700, 'Invalid JSON')
  }

  if (message.jsonrpc !== '2.0' || !message.method) {
    return jsonRpcError(message.id, -32600, 'Invalid JSON-RPC request')
  }

  if (message.id == null && message.method.startsWith('notifications/')) {
    return new Response(null, { status: 202, headers: corsHeaders })
  }

  if (message.method === 'initialize') {
    const protocolVersion = negotiatedProtocolVersion(message.params?.protocolVersion)
    return jsonRpcResult(message.id, {
      protocolVersion,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: 'portfolio-chatgpt-probe',
        title: 'Portfolio Connection Probe',
        version: '0.1.0',
      },
      instructions: 'Use ping only to verify that this connection works. No portfolio data is available from this probe.',
    }, protocolVersion)
  }

  if (message.method === 'tools/list') {
    return jsonRpcResult(message.id, { tools: toolDefinitions() })
  }

  if (message.method !== 'tools/call') {
    return jsonRpcError(message.id, -32601, `Unsupported method: ${message.method}`)
  }

  const toolName = String(message.params?.name ?? '')
  if (toolName !== 'ping') {
    return jsonRpcError(message.id, -32602, `Unknown tool: ${toolName}`)
  }

  const result = {
    ok: true,
    service: 'portfolio-chatgpt-probe',
    message: 'ChatGPT can reach the portfolio MCP probe. No private portfolio data was read or changed.',
  }

  return jsonRpcResult(message.id, {
    content: [{ type: 'text', text: result.message }],
    structuredContent: result,
  })
})
