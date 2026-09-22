#!/usr/bin/env node
/**
 * Zero-dependency OpenAI-compatible mock server for testing M.I.K.E. in local VS Code.
 * Simulates SSE streaming deltas and tool calls (write_file, list_dir, read_file).
 */
import http from 'http';

const PORT = 11435;

const server = http.createServer(async (req, res) => {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url || '';

  if (req.method === 'GET' && (url.endsWith('/models') || url.includes('/models'))) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache'
    });
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'qwen2.5-coder-32b', object: 'model', created: 1700000000, owned_by: 'local' },
        { id: 'deepseek-coder-v2', object: 'model', created: 1700000000, owned_by: 'local' },
        { id: 'gpt-4o', object: 'model', created: 1700000000, owned_by: 'openai' },
        { id: 'claude-3-5-sonnet', object: 'model', created: 1700000000, owned_by: 'anthropic' },
        { id: 'mock-coder-v1', object: 'model', created: 1700000000, owned_by: 'mike' }
      ]
    }));
    return;
  }

  if (req.method === 'POST' && (url.endsWith('/chat/completions') || url.includes('/chat/completions'))) {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const messages = parsed.messages || [];
        const lastMessage = messages[messages.length - 1];

        // Prepare SSE Response
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive'
        });

        // Check if last message was a tool result
        if (lastMessage && lastMessage.role === 'tool') {
          // Agent final response turn after executing a tool
          let toolResultPreview = '';
          try {
            const parsedRes = JSON.parse(lastMessage.content);
            if (parsedRes.totalErrors !== undefined || parsedRes.totalWarnings !== undefined) {
              const errs = parsedRes.totalErrors || 0;
              const warns = parsedRes.totalWarnings || 0;
              toolResultPreview = `\n\n### 🔍 Workspace Diagnostics Report\n- **Errors**: ${errs}\n- **Warnings**: ${warns}\n`;
              if (parsedRes.diagnostics && parsedRes.diagnostics.length > 0) {
                toolResultPreview += `\n**Discovered Issues:**\n` +
                  parsedRes.diagnostics.map(d => `  - **${d.severity}** in \`${d.file}:${d.line}:${d.column}\` [${d.source}${d.code ? `:${d.code}` : ''}]: ${d.message}`).join('\n');
              } else {
                toolResultPreview += `\n✨ **No issues detected.** The workspace language server reports 100% clean diagnostics!`;
              }
            } else if (parsedRes.matches !== undefined) {
              toolResultPreview = `\n\n### 🔍 Workspace Grep Search Results for \`${parsedRes.query}\`\n- **Found**: ${parsedRes.totalMatches} matches in ${parsedRes.filesSearched} files searched.\n\n` +
                parsedRes.matches.map(m => `  - \`${m.file}:${m.line}\`: \`${m.content}\``).join('\n');
            } else if (parsedRes.diagnostics) {
              const errs = parsedRes.diagnostics.errorCount || 0;
              const warns = parsedRes.diagnostics.warningCount || 0;
              toolResultPreview = `\n- **Diagnostics**: ${errs} errors, ${warns} warnings.`;
              if (errs > 0) {
                toolResultPreview += `\n  - Issues:\n    ${parsedRes.diagnostics.messages.join('\n    ')}`;
              }
            } else if (parsedRes.symbols) {
              toolResultPreview = `\n- **Discovered Symbols (${parsedRes.count})**:\n` +
                parsedRes.symbols.map(s => `  - \`${s.kind}\` **${s.name}** in \`${s.location.file}:${s.location.line}\``).join('\n');
            }
          } catch {}

          await sendTextStream(
            res,
            `Successfully executed tool **${lastMessage.name || 'tool'}**.${toolResultPreview}\n\nOperation completed cleanly.`
          );
        } else {
          const prompt = lastMessage?.content || '';
          const lower = prompt.toLowerCase();

          if (prompt.includes('Target Selection to Transform:') || prompt.includes('Instruction:')) {
            // Inline transform request!
            const isAsync = lower.includes('async') || lower.includes('await');
            const isDoc = lower.includes('jsdoc') || lower.includes('type') || lower.includes('docstring');
            const isErrorCheck = lower.includes('error') || lower.includes('null') || lower.includes('boundary') || lower.includes('defensive');

            if (isAsync) {
              await sendTextStream(
                res,
                `export async function calculateTotalAsync(items: Array<{ price: number; qty: number }>): Promise<number> {\n  return new Promise((resolve) => {\n    const total = items.reduce((sum, item) => sum + (item.price * item.qty), 0);\n    resolve(total);\n  });\n}`
              );
            } else if (isDoc) {
              await sendTextStream(
                res,
                `/**\n * Calculates the geometric mean of two positive numbers.\n * @param a - First non-negative numeric factor\n * @param b - Second non-negative numeric factor\n * @returns Geometric mean as a double-precision float\n */\nexport function geometricMean(a: number, b: number): number {\n  if (a < 0 || b < 0) {\n    throw new RangeError("Factors must be non-negative");\n  }\n  return Math.sqrt(a * b);\n}`
              );
            } else if (isErrorCheck) {
              await sendTextStream(
                res,
                `export function safeDivide(numerator: number, denominator: number): number {\n  if (typeof numerator !== 'number' || typeof denominator !== 'number') {\n    throw new TypeError('Arguments must be numeric');\n  }\n  if (denominator === 0) {\n    throw new RangeError('Division by zero is undefined');\n  }\n  return numerator / denominator;\n}`
              );
            } else {
              await sendTextStream(
                res,
                `/**\n * Transformed by M.I.K.E. (Cmd+I)\n */\nexport function optimizedCalculation(x: number, y: number): number {\n  return Math.hypot(x, y);\n}`
              );
            }
          } else if (prompt.includes('[SPECIALIZED SKILL ACTIVATED:')) {
            const skillNameMatch = prompt.match(/\[SPECIALIZED SKILL ACTIVATED:\s*([^(\]]+)/);
            const skillName = skillNameMatch ? skillNameMatch[1].trim() : 'Specialized Skill';
            await sendTextStream(
              res,
              `⚡ **Skill Activated**: \`${skillName}\`\n\nI have loaded the specialized skill instructions and will now execute your task...`
            );
            await sendToolCallStream(
              res,
              "write_file",
              JSON.stringify({
                path: "src/skill_result.ts",
                content: `// Generated via Skill: ${skillName}\nexport const skillStatus = "active";\nexport function executeWorkflow(): boolean {\n  return true;\n}\n`
              })
            );
          } else if (lower.includes('grep') || lower.includes('search for') || lower.includes('find text') || lower.includes('find string') || lower.includes('search in files')) {
            const grepMatch = prompt.match(/(?:grep|search for|find text|find string|search in files|search)\s+["']?([^"'\n]+)["']?/i);
            const queryWord = grepMatch ? grepMatch[1].trim() : "Calculator";
            await sendTextStream(res, `Performing full-text VFS workspace grep for \`${queryWord}\` across all files...`);
            await sendToolCallStream(
              res,
              "grep_search",
              JSON.stringify({ query: queryWord })
            );
          } else if (prompt.includes('Fix this compiler/type error in') || (lower.includes('fix') && lower.includes('error'))) {
            const isBrokenMath = prompt.includes('broken_math.ts') || lower.includes('broken_math');
            if (isBrokenMath) {
              await sendTextStream(
                res,
                `Identified type mismatch error in \`mock_workspace/src/broken_math.ts\`. Rewriting function to properly calculate and return circle area as a number...`
              );
              await sendToolCallStream(
                res,
                "write_file",
                JSON.stringify({
                  path: "src/broken_math.ts",
                  content: `/**\n * Circle area calculator (Self-healed by M.I.K.E.)\n */\nexport function calculateCircleArea(radius: number): number {\n  if (radius < 0) {\n    throw new Error("Radius cannot be negative");\n  }\n  return Math.PI * radius * radius;\n}\n`
                })
              );
            } else {
              await sendTextStream(res, "Analyzing diagnostic error and applying surgical fix...");
              await sendToolCallStream(
                res,
                "write_file",
                JSON.stringify({
                  path: "src/utils.ts",
                  content: `// Fixed by M.I.K.E.\nexport function formatTimestamp(d: Date): string {\n  return d.toISOString();\n}\n\nexport function isValidId(id: string): boolean {\n  return Boolean(id && id.length > 0);\n}\n`
                })
              );
            }
          } else if (prompt.includes('Explain the following code') || lower.includes('explain')) {
            await sendTextStream(
              res,
              `### 📖 Code Architectural Analysis\n\n1. **Core Responsibility**: The selected module implements mathematical operations with input boundary validation.\n2. **Type Safety**: Strictly typed parameters and return signatures prevent runtime coercion errors.\n3. **Error Boundaries**: Division by zero and negative radical inputs throw explicit descriptive runtime exceptions.\n4. **Maintainability**: Pure functional and stateless class design enables zero-friction unit testing.`
            );
          } else if (prompt.includes('Refactor and optimize') || lower.includes('refactor')) {
            await sendTextStream(
              res,
              `Refactoring selected code for enhanced type safety and performance...`
            );
            await sendToolCallStream(
              res,
              "write_file",
              JSON.stringify({
                path: "src/calculator.ts",
                content: `/**\n * Optimized Calculator Module\n */\nexport class Calculator {\n  public add(a: number, b: number): number {\n    return a + b;\n  }\n\n  public subtract(a: number, b: number): number {\n    return a - b;\n  }\n\n  public multiply(a: number, b: number): number {\n    return a * b;\n  }\n\n  public divide(a: number, b: number): number {\n    if (b === 0) throw new Error("Division by zero");\n    return a / b;\n  }\n\n  public power(base: number, exp: number): number {\n    return Math.pow(base, exp);\n  }\n\n  public sqrt(val: number): number {\n    if (val < 0) throw new Error("Cannot calculate square root of negative number");\n    return Math.sqrt(val);\n  }\n}\n`
              })
            );
          } else if (prompt.includes('Generate comprehensive unit tests') || lower.includes('generate tests') || lower.includes('unit test')) {
            await sendTextStream(
              res,
              `Generating complete test suite covering happy paths and edge cases...`
            );
            await sendToolCallStream(
              res,
              "write_file",
              JSON.stringify({
                path: "scripts/test_math.mjs",
                content: `import assert from 'node:assert';\nimport { Calculator } from '../src/calculator.js';\n\nconsole.log('🧪 Running M.I.K.E. Generated Test Suite...');\nconst calc = new Calculator();\n\nassert.strictEqual(calc.add(2, 3), 5, 'add(2, 3) should equal 5');\nassert.strictEqual(calc.subtract(10, 4), 6, 'subtract(10, 4) should equal 6');\nassert.strictEqual(calc.multiply(3, 7), 21, 'multiply(3, 7) should equal 21');\nassert.strictEqual(calc.divide(20, 4), 5, 'divide(20, 4) should equal 5');\nassert.strictEqual(calc.power(2, 3), 8, 'power(2, 3) should equal 8');\nassert.strictEqual(calc.sqrt(16), 4, 'sqrt(16) should equal 4');\n\nconsole.log('✅ All 6 unit tests passed successfully!');\n`
              })
            );
          } else if (lower.includes('diagnostic') || lower.includes('error') || lower.includes('problem') || lower.includes('broken') || lower.includes('fix all') || lower.includes('issue')) {
            await sendTextStream(res, "Scanning workspace Language Server diagnostics across all files...");
            await sendToolCallStream(
              res,
              "get_diagnostics",
              JSON.stringify({ severity: "all" })
            );
          } else if (prompt.includes('[ACTIVE SELECTION:') || prompt.includes('[ACTIVE FILE:') || lower.includes('editor')) {
            const isCalc = prompt.includes('calculator') || lower.includes('calculator');
            if (isCalc) {
              await sendTextStream(
                res,
                `Analyzing active editor file \`src/calculator.ts\`. Adding exponentiation (\`power\`) and square root (\`sqrt\`) methods while preserving all existing math operations...`
              );
              await sendToolCallStream(
                res,
                "write_file",
                JSON.stringify({
                  path: "src/calculator.ts",
                  content: `/**\n * Enhanced Calculator Module\n */\nexport class Calculator {\n  public add(a: number, b: number): number {\n    return a + b;\n  }\n\n  public subtract(a: number, b: number): number {\n    return a - b;\n  }\n\n  public multiply(a: number, b: number): number {\n    return a * b;\n  }\n\n  public divide(a: number, b: number): number {\n    if (b === 0) {\n      throw new Error("Division by zero");\n    }\n    return a / b;\n  }\n\n  public power(base: number, exp: number): number {\n    return Math.pow(base, exp);\n  }\n\n  public sqrt(val: number): number {\n    if (val < 0) {\n      throw new Error("Cannot calculate square root of negative number");\n    }\n    return Math.sqrt(val);\n  }\n}\n\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function subtract(a: number, b: number): number {\n  return a - b;\n}\n\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}\n\nexport function divide(a: number, b: number): number {\n  if (b === 0) {\n    throw new Error("Division by zero");\n  }\n  return a / b;\n}\n`
                })
              );
            } else {
              await sendTextStream(
                res,
                `I received your active editor context. I am analyzing the referenced file and applying modifications...`
              );
              await sendToolCallStream(
                res,
                "write_file",
                JSON.stringify({
                  path: "src/utils.ts",
                  content: `// Enhanced by M.I.K.E. via @editor context\nexport function formatTimestamp(d: Date): string {\n  return d.toISOString();\n}\n\nexport function isValidId(id: string): boolean {\n  return Boolean(id && id.length > 0);\n}\n`
                })
              );
            }
          } else if (lower.includes('symbol') || lower.includes('find') || lower.includes('where is')) {
            const symMatch = prompt.match(/(?:symbol|find|where is)\s+([a-zA-Z0-9_$]+)/i);
            const queryWord = symMatch ? symMatch[1] : "Calculator";
            await sendTextStream(res, `Searching workspace AST symbol index for definitions of \`${queryWord}\`...`);
            await sendToolCallStream(
              res,
              "find_symbol",
              JSON.stringify({ query: queryWord })
            );
          } else if (lower.includes('test') || lower.includes('run')) {
            await sendTextStream(res, "Executing workspace test command...");
            await sendToolCallStream(
              res,
              "run_command",
              JSON.stringify({ command: "node -e 'console.log(\"All 6 unit tests passed (0 errors).\")'" })
            );
          } else if (lower.includes('list') || lower.includes('dir')) {
            await sendTextStream(res, "Inspecting workspace directory structure...");
            await sendToolCallStream(res, "list_dir", JSON.stringify({ path: "" }));
          } else {
            await sendTextStream(res, "Inspecting workspace and active context...");
            await sendToolCallStream(
              res,
              "read_file",
              JSON.stringify({
                path: "src/calculator.ts"
              })
            );
          }
        }

        res.write('data: [DONE]\n\n');
        res.end();
      } catch (err) {
        console.error('Error handling mock request:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendTextStream(res, fullText) {
  const words = fullText.split(' ');
  for (let i = 0; i < words.length; i++) {
    const chunk = (i === 0 ? '' : ' ') + words[i];
    const sseData = {
      choices: [
        {
          delta: {
            content: chunk
          }
        }
      ]
    };
    res.write(`data: ${JSON.stringify(sseData)}\n\n`);
    await sleep(25);
  }
}

async function sendToolCallStream(res, toolName, toolArgs) {
  const callId = `call_${Date.now()}`;
  // 1. Initial chunk with function name and id
  const initial = {
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: callId,
              function: {
                name: toolName,
                arguments: ""
              }
            }
          ]
        }
      }
    ]
  };
  res.write(`data: ${JSON.stringify(initial)}\n\n`);
  await sleep(40);

  // 2. Stream arguments in chunks
  const chunkSize = 15;
  for (let i = 0; i < toolArgs.length; i += chunkSize) {
    const piece = toolArgs.slice(i, i + chunkSize);
    const argChunk = {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                function: {
                  arguments: piece
                }
              }
            ]
          }
        }
      ]
    };
    res.write(`data: ${JSON.stringify(argChunk)}\n\n`);
    await sleep(20);
  }
}

server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 M.I.K.E. Local Mock LLM Server running on:`);
  console.log(`   http://localhost:${PORT}/v1`);
  console.log(`======================================================`);
  console.log(`Configure M.I.K.E. in VS Code Settings:`);
  console.log(`   mike.baseUrl = "http://localhost:${PORT}/v1"`);
  console.log(`   mike.apiKey  = "mock-key"`);
  console.log(`   mike.model   = "mock-coder-v1"`);
  console.log(`======================================================\n`);
});
