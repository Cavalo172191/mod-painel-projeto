import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Acontecimento, Etapa, GitInfo, Pendencia, Projeto, Retrato } from '../types'

// Painel do Projeto: o projeto do cliente aberto nesta sessão, ao lado do chat.
// Em que etapa do fluxo Genesis ele está, o que falta salvar ou publicar,
// as pendências, o tempo trabalhado, e botões que disparam o próximo passo.

const PAINEL = 'painel-projeto'
const TITULO = 'Painel do Projeto'
const FERRAMENTA = 'mcp__painel-projeto__pendencias'

// Muda a etiqueta quando o formato do retrato mudar: o valor guardado por uma
// versão anterior sobrevive ao recarregamento e seria lido errado.
const retrato = atom({ plugin: 'painel-projeto', key: 'retrato' } as const, null, { shape: 'retrato-1' })
const ajustes = atom({ plugin: 'painel-projeto', key: 'ajustes' } as const, { editarValor: false, editarLink: false })

type Motor = EngineInterface

// O fluxo de um app novo na mentoria: número do atalho e skill de cada etapa.
const FLUXO: { etapa: Etapa; numero: string; nome: string }[] = [
  { etapa: 'plano', numero: '110', nome: 'Plano' },
  { etapa: 'construcao', numero: '106', nome: 'Construção' },
  { etapa: 'backup', numero: '103', nome: 'Backup' },
  { etapa: 'publicado', numero: '108', nome: 'Publicado' },
]

// Skill chamada -> etapa que ela marca no painel.
const SKILLS: [string, Etapa, string][] = [
  ['genesis-iniciar', 'plano', 'Plano iniciado (110)'],
  ['genesis-jose-planejador', 'plano', 'Planejamento com o José (113)'],
  ['genesis-continuar', 'construcao', 'Construção em andamento (106)'],
  ['genesis-backup-criar', 'backup', 'Backup criado (103)'],
  ['genesis-github-easypanel', 'publicado', 'Publicação pelo GitHub (108)'],
]

const MUDAM_ARQUIVOS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])
const ARQUIVOS_DE_CODIGO = new Set([
  'package.json', 'index.html', 'src', 'app', 'pages', 'public', 'requirements.txt', 'main.py', 'app.py',
  'pubspec.yaml', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs', 'server.js',
])
const NOME_DE_PLANO = /(plano|plan|escopo|prd|spec|briefing|requisitos|roadmap)/i

// ---------- utilidades ----------

const agora = () => Date.now()

function hoje(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function rel(t: number): string {
  const s = Math.max(0, Math.round((agora() - t) / 1000))
  if (s < 60) return 'agora há pouco'
  const m = Math.round(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.round(h / 24)

  return d === 1 ? 'há 1 dia' : `há ${d} dias`
}

function duracao(min: number): string {
  const total = Math.round(min)
  if (total < 60) return `${total} min`
  const h = Math.floor(total / 60)
  const m = total % 60

  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`

const nomeDaPasta = (pasta: string) => pasta.split(/[\\/]/).filter(Boolean).pop() ?? pasta

const chaveDoProjeto = (pasta: string) => `projeto:${pasta.replace(/\\/g, '/').toLowerCase()}`

const novoId = () => `${agora().toString(36)}${Math.random().toString(36).slice(2, 6)}`

// Endereço do GitHub para abrir no navegador, sem nenhuma credencial embutida.
function enderecoWeb(remoto: string): string {
  let url = remoto.trim()
  const ssh = /^git@([^:]+):(.+)$/.exec(url)
  if (ssh) url = `https://${ssh[1]}/${ssh[2]}`
  url = url.replace(/^(https?:\/\/)[^@/]+@/, '$1').replace(/\.git$/, '')

  return /^https?:\/\//.test(url) ? url : ''
}

function projetoVazio(): Projeto {
  return { marcas: {}, pendencias: [], minutosTotal: 0, dia: hoje(), minutosHoje: 0, linkApp: '', historico: [] }
}

function normalizar(v: unknown): Projeto {
  const base = projetoVazio()
  if (typeof v !== 'object' || v === null) return base
  const p = { ...base, ...(v as Partial<Projeto>) }
  if (!Array.isArray(p.pendencias)) p.pendencias = []
  if (!Array.isArray(p.historico)) p.historico = []
  if (typeof p.marcas !== 'object' || p.marcas === null) p.marcas = {}
  if (p.dia !== hoje()) return { ...p, dia: hoje(), minutosHoje: 0 }

  return p
}

// ---------- leitura do projeto ----------

async function rodarGit($: Motor, pasta: string, args: string[]) {
  return $.process.run(['git', ...args], { cwd: pasta, timeoutMs: 8000 }).catch(() => null)
}

async function lerGit($: Motor, pasta: string): Promise<GitInfo> {
  const semGit: GitInfo = { temGit: false, branch: '', alterados: 0, ultimoCommit: null, remoto: '', temUpstream: false, aFrente: 0 }
  const dentro = await rodarGit($, pasta, ['rev-parse', '--is-inside-work-tree'])
  if (!dentro || dentro.exitCode !== 0 || !dentro.stdout.includes('true')) return semGit

  const [status, log, branch, remoto, frente] = await Promise.all([
    rodarGit($, pasta, ['status', '--porcelain']),
    rodarGit($, pasta, ['log', '-1', '--format=%ct%x1f%s']),
    rodarGit($, pasta, ['rev-parse', '--abbrev-ref', 'HEAD']),
    rodarGit($, pasta, ['remote', 'get-url', 'origin']),
    rodarGit($, pasta, ['rev-list', '--count', '@{u}..HEAD']),
  ])

  let ultimoCommit: GitInfo['ultimoCommit'] = null
  if (log && log.exitCode === 0 && log.stdout.trim()) {
    const [t, msg] = log.stdout.trim().split('\x1f')
    ultimoCommit = { t: Number(t) * 1000, msg: (msg ?? '').slice(0, 80) }
  }
  const temUpstream = !!frente && frente.exitCode === 0

  return {
    temGit: true,
    branch: branch && branch.exitCode === 0 ? branch.stdout.trim() : '',
    alterados: status && status.exitCode === 0 ? status.stdout.split('\n').filter(l => l.trim()).length : 0,
    ultimoCommit,
    remoto: remoto && remoto.exitCode === 0 ? enderecoWeb(remoto.stdout) : '',
    temUpstream,
    aFrente: temUpstream ? Number(frente.stdout.trim()) || 0 : 0,
  }
}

async function lerArquivos($: Motor, pasta: string) {
  const nomes = async (p: string) => (await $.fs.list(p).catch(() => [])).map(x => x.name)
  const raiz = await nomes(pasta)
  const docs = raiz.includes('docs') ? await nomes(`${pasta}/docs`) : []
  const temPlano = [...raiz, ...docs].some(n => n.toLowerCase().endsWith('.md') && NOME_DE_PLANO.test(n))
  const temCodigo = raiz.some(n => ARQUIVOS_DE_CODIGO.has(n.toLowerCase()))

  return { temPlano, temCodigo }
}

async function lerProjeto($: Motor, pasta: string): Promise<Projeto> {
  return normalizar(await $.store.get(chaveDoProjeto(pasta)).catch(() => undefined))
}

async function atualizar($: Motor): Promise<Retrato | null> {
  const pasta = await $.session.cwd().catch(() => '')
  if (!pasta) return null
  const [git, arquivos, projeto, valor] = await Promise.all([
    lerGit($, pasta),
    lerArquivos($, pasta),
    lerProjeto($, pasta),
    $.store.get('valorHora').catch(() => 0),
  ])
  const r: Retrato = {
    pasta,
    nome: nomeDaPasta(pasta),
    projeto,
    git,
    ...arquivos,
    valorHora: Number(valor) || 0,
    lidoEm: agora(),
  }
  await update($, retrato, () => r)
  const prox = proximoPasso(r)
  $.ui.status(`📁 ${r.nome} · próximo: ${prox.numero} ${prox.nome}`)

  return r
}

// Muda o que o painel guarda deste projeto e redesenha.
async function mudarProjeto($: Motor, fn: (p: Projeto) => Projeto) {
  const pasta = await $.session.cwd()
  const p = fn(await lerProjeto($, pasta))
  await $.store.set(chaveDoProjeto(pasta), p)
  await atualizar($)
}

const comHistorico = (p: Projeto, texto: string): Projeto => ({
  ...p,
  historico: [{ t: agora(), texto }, ...p.historico].slice(0, 12),
})

async function marcar($: Motor, etapa: Etapa, texto: string) {
  await mudarProjeto($, p => comHistorico({ ...p, marcas: { ...p.marcas, [etapa]: agora() } }, texto))
}

// ---------- a lógica das etapas ----------

type Estado = 'feito' | 'atencao' | 'pendente'
type Linha = { etapa: Etapa; numero: string; nome: string; estado: Estado; detalhe: string }

function linhas(r: Retrato): Linha[] {
  const { marcas } = r.projeto
  const g = r.git

  const plano: [Estado, string] = marcas.plano
    ? ['feito', `iniciado ${rel(marcas.plano)}`]
    : r.temPlano
      ? ['feito', 'plano encontrado na pasta']
      : ['pendente', 'ainda sem plano']

  const construcao: [Estado, string] = r.temCodigo
    ? ['feito', marcas.construcao ? `última sessão ${rel(marcas.construcao)}` : 'código na pasta']
    : marcas.construcao
      ? ['feito', `iniciada ${rel(marcas.construcao)}`]
      : ['pendente', 'nenhum código ainda']

  let backup: [Estado, string]
  if (g.temGit && g.ultimoCommit) {
    backup = g.alterados > 0
      ? ['atencao', `${plural(g.alterados, 'arquivo alterado', 'arquivos alterados')} sem backup`]
      : ['feito', `último ${rel(g.ultimoCommit.t)}`]
  } else if (marcas.backup) {
    backup = ['feito', `último ${rel(marcas.backup)}`]
  } else {
    backup = ['pendente', 'nenhum backup ainda']
  }

  let publicado: [Estado, string]
  if (g.temUpstream) {
    publicado = g.aFrente > 0
      ? ['atencao', `${plural(g.aFrente, 'versão esperando', 'versões esperando')} publicar`]
      : ['feito', 'em dia com o GitHub']
  } else if (marcas.publicado) {
    publicado = ['feito', `publicado ${rel(marcas.publicado)}`]
  } else if (g.remoto) {
    publicado = ['atencao', 'GitHub ligado, falta publicar']
  } else {
    publicado = ['pendente', 'ainda não está no GitHub']
  }

  const porEtapa: Record<Etapa, [Estado, string]> = { plano, construcao, backup, publicado }

  return FLUXO.map(f => ({ ...f, estado: porEtapa[f.etapa][0], detalhe: porEtapa[f.etapa][1] }))
}

function proximoPasso(r: Retrato): { numero: string; nome: string; motivo: string } {
  const falta = linhas(r).find(l => l.estado !== 'feito')
  if (falta) return { numero: falta.numero, nome: falta.nome, motivo: falta.detalhe }

  return { numero: '106', nome: 'Continuar construindo', motivo: 'Tudo salvo e no ar. Bora para a próxima melhoria.' }
}

const ICONE: Record<Estado, string> = { feito: '✅', atencao: '⚠️', pendente: '⬜' }

// ---------- o mod ----------

// Valores desta carga do módulo (um recarregamento começa de novo, e tudo bem).
let inicioDoTurno = 0
let ultimoAviso = 0
let agendado: { cancel: () => void } | null = null

// Relê o projeto um instante depois que o Claude mexe em arquivos (junta várias mudanças).
function agendar($: Motor) {
  if (agendado) return
  agendado = $.clock.after(1500, () => {
    agendado = null
    void atualizar($)
  })
}

// Um botão do painel manda o atalho da etapa, como se você digitasse "103".
function enviar($: Motor, numero: string, nome: string) {
  $.ui.toast(`▶ ${numero} ${nome}: mandando para o Claude`)
  void $.prompt.submit({ text: numero })
}

// Aviso automático: muita coisa alterada sem backup, ou versão salva e não publicada.
function avisar($: Motor, r: Retrato) {
  if (agora() - ultimoAviso < 20 * 60_000) return
  const g = r.git
  const desde = g.ultimoCommit?.t ?? r.projeto.marcas.construcao ?? 0
  if (g.temGit && g.alterados >= 3 && (!g.ultimoCommit || agora() - desde > 30 * 60_000)) {
    ultimoAviso = agora()
    const quando = g.ultimoCommit ? `o último backup foi ${rel(g.ultimoCommit.t)}` : 'ainda não tem nenhum backup'
    $.ui.toast(`💾 ${r.nome}: ${plural(g.alterados, 'arquivo alterado', 'arquivos alterados')} e ${quando}. Toque em "103 Backup" no Painel do Projeto.`)
  } else if (g.temUpstream && g.aFrente > 0 && g.alterados === 0) {
    ultimoAviso = agora()
    $.ui.toast(`🚀 ${r.nome}: ${plural(g.aFrente, 'versão salva', 'versões salvas')} e o cliente ainda não vê. Toque em "108 Publicado" no painel.`)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'painel', description: 'Abre o Painel do Projeto ao lado do chat' })
    await $.tool.register({
      name: 'pendencias',
      description:
        'Lista de pendências do projeto aberto, mostrada ao lado da conversa no Painel do Projeto. ' +
        'Use "adicionar" sempre que algo ficar para depois (bug, ajuste pedido pelo cliente, próximo recurso, ' +
        'algo que você não terminou), "concluir" com o número do item quando terminá-lo, e "listar" para ver os itens abertos.',
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          acao: { type: 'string', enum: ['adicionar', 'concluir', 'listar'] },
          texto: { type: 'string', description: 'O que fazer, em uma frase curta (para adicionar).' },
          numero: { type: 'number', description: 'O número do item na lista de abertos (para concluir).' },
        },
        required: ['acao'],
      },
    })
    void $.ui.open({ id: PAINEL, title: TITULO })
    void atualizar($)
    $.clock.every(30_000, () => void atualizar($))

    return next(e)
  })

  on('command.run', { command: 'painel' }, async $ => {
    await $.ui.open({ id: PAINEL, title: TITULO })
    await atualizar($)

    return { text: 'Painel do Projeto aberto ao lado do chat.' }
  })

  // O tempo de trabalho com o Claude neste projeto: do envio da mensagem ao fim da resposta.
  on('prompt.submit', ($, e, next) => {
    if (inicioDoTurno === 0) inicioDoTurno = agora()

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if ((e as unknown as { agentId?: string }).agentId) return ran
    if (inicioDoTurno > 0) {
      const minutos = Math.min((agora() - inicioDoTurno) / 60_000, 60)
      inicioDoTurno = 0
      await mudarProjeto($, p => ({ ...p, minutosTotal: p.minutosTotal + minutos, minutosHoje: p.minutosHoje + minutos }))
    }
    const r = await atualizar($)
    if (r) avisar($, r)

    return ran
  }).catch(($, e, next) => next(e))

  // Vigia as skills do fluxo e os comandos de git para marcar as etapas.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const ferramenta = String(e.tool)
    if (ferramenta === FERRAMENTA || ran.deny !== undefined || ran.isError === true) return ran
    const x = e as unknown as Record<string, unknown>

    const skill = ferramenta.endsWith('__skill') || ferramenta === 'Skill' ? String(x.skill ?? '') : ''
    const achou = skill ? SKILLS.find(([padrao]) => skill.includes(padrao)) : undefined
    if (achou) {
      await marcar($, achou[1], achou[2])
    } else if (ferramenta === 'Bash' || ferramenta === 'PowerShell') {
      const cmd = String(x.command ?? '')
      if (/\bgit\s+push\b/.test(cmd)) await marcar($, 'publicado', 'Enviado para o GitHub (git push)')
      else if (/\bgit\s+commit\b/.test(cmd)) await marcar($, 'backup', 'Versão salva (git commit)')
    }
    if (MUDAM_ARQUIVOS.has(ferramenta)) agendar($)

    return ran
  }).catch(($, e, next) => next(e))

  // A ferramenta que o Claude usa para cuidar das pendências.
  on('tool.call', { tool: FERRAMENTA }, async ($, e) => {
    const x = e as unknown as { acao?: string; texto?: string; numero?: number }
    const pasta = await $.session.cwd()
    const antes = await lerProjeto($, pasta)
    const abertas = antes.pendencias.filter(p => !p.feita)

    if (x.acao === 'adicionar') {
      const texto = String(x.texto ?? '').trim().slice(0, 200)
      if (!texto) return { deny: 'Diga o texto da pendência.' }
      await mudarProjeto($, p => comHistorico(
        { ...p, pendencias: [...p.pendencias, { id: novoId(), texto, feita: false, criada: agora() }] },
        `Pendência anotada: ${texto}`,
      ))

      return { result: `Anotado no Painel do Projeto (${plural(abertas.length + 1, 'aberta', 'abertas')}): ${texto}` }
    }
    if (x.acao === 'concluir') {
      const alvo = abertas[Number(x.numero) - 1]
      if (!alvo) return { deny: `Não há item ${x.numero} entre os ${abertas.length} abertos.` }
      await mudarProjeto($, p => comHistorico(
        { ...p, pendencias: p.pendencias.map(q => (q.id === alvo.id ? { ...q, feita: true } : q)) },
        `Pendência concluída: ${alvo.texto}`,
      ))

      return { result: `Concluído: ${alvo.texto}` }
    }
    const lista = abertas.map((p, i) => `${i + 1}. ${p.texto}`).join('\n')

    return { result: lista ? `Pendências abertas de ${nomeDaPasta(pasta)}:\n${lista}` : 'Nenhuma pendência aberta.' }
  }).catch(() => ({ deny: 'O Painel do Projeto não conseguiu ler as pendências agora.' }))

  // ---------- o desenho do painel ----------

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Input = 'Input' in ui ? ui.Input : null
    const Link = 'Link' in ui ? ui.Link : null
    const r = await read($, retrato)
    const aj = await read($, ajustes)

    if (!r) return <Text dimColor>Lendo o projeto…</Text>

    const g = r.git
    const etapas = linhas(r)
    const prox = proximoPasso(r)
    const abertas = r.projeto.pendencias.filter(p => !p.feita)
    const feitas = r.projeto.pendencias.filter(p => p.feita)
    const pareceProjeto = g.temGit || r.temCodigo || r.temPlano
    const valorTrabalho = r.valorHora > 0 ? (r.projeto.minutosTotal / 60) * r.valorHora : 0

    const alternar = (p: Pendencia) =>
      mudarProjeto($, q => comHistorico(
        { ...q, pendencias: q.pendencias.map(x => (x.id === p.id ? { ...x, feita: !x.feita } : x)) },
        p.feita ? `Pendência reaberta: ${p.texto}` : `Pendência concluída: ${p.texto}`,
      ))

    const secao = (titulo: string) => (
      <Box marginTop={1}>
        <Text bold color="claude">{titulo}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box justifyContent="space-between">
          <Text bold>📁 {r.nome}</Text>
          <Button key="atualizar" label="↻ Atualizar" plain onPress={() => void atualizar($)} />
        </Box>
        <Text dimColor>
          {g.temGit ? `ramo ${g.branch || '?'} · ` : 'sem Git ainda · '}lido {rel(r.lidoEm)}
        </Text>
        {!pareceProjeto && (
          <Text color="warning">
            Esta pasta não parece um app. Abra a sessão na pasta do app do cliente (Desktop\nome-do-app).
          </Text>
        )}

        {secao('Fluxo do app')}
        {etapas.map((l, i) => (
          <Button key={`etapa-${l.etapa}`} plain onPress={() => enviar($, l.numero, l.nome)}>
            {ICONE[l.estado]} {i + 1}. {l.nome} <Text dimColor>({l.numero}) · {l.detalhe}</Text>
          </Button>
        ))}

        <Box marginTop={1} flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
          <Text bold>Próximo passo</Text>
          <Text dimColor>{prox.motivo}</Text>
          <Button key="proximo" variant="primary" label={`▶ ${prox.numero} · ${prox.nome}`} onPress={() => enviar($, prox.numero, prox.nome)} />
        </Box>

        {secao('No ar')}
        {g.remoto && Link ? <Link href={g.remoto} label="GitHub do projeto" /> : <Text dimColor>GitHub: ainda não ligado</Text>}
        {r.projeto.linkApp && !aj.editarLink ? (
          <Box justifyContent="space-between">
            {Link ? <Link href={r.projeto.linkApp} label="🌐 Abrir o app do cliente" /> : <Text>🌐 {r.projeto.linkApp}</Text>}
            <Button key="trocar-link" label="trocar" plain dimColor onPress={() => update($, ajustes, a => ({ ...a, editarLink: true }))} />
          </Box>
        ) : Input ? (
          <Input
            key="link-app"
            placeholder="Cole o endereço do app no ar (Easypanel)"
            submitLabel="Salvar"
            onSubmit={valor => {
              const link = valor.trim()
              void update($, ajustes, a => ({ ...a, editarLink: false }))
              if (/^https?:\/\//.test(link)) void mudarProjeto($, p => comHistorico({ ...p, linkApp: link }, 'Endereço do app salvo'))
              else $.ui.toast('O endereço precisa começar com http:// ou https://')
            }}
          />
        ) : null}

        {secao(`Pendências (${abertas.length} ${abertas.length === 1 ? 'aberta' : 'abertas'})`)}
        {abertas.length === 0 && <Text dimColor>Nada pendente. Peça ao Claude para anotar o que ficar para depois.</Text>}
        {abertas.map(p => (
          <Button key={`p-${p.id}`} plain onPress={() => void alternar(p)}>
            ☐ {p.texto}
          </Button>
        ))}
        {feitas.slice(-3).map(p => (
          <Button key={`p-${p.id}`} plain dimColor onPress={() => void alternar(p)}>
            ☑ <Text strikethrough dimColor>{p.texto}</Text>
          </Button>
        ))}
        {Input && (
          <Input
            key={`nova-${r.projeto.pendencias.length}`}
            placeholder="Nova pendência (Enter para anotar)"
            onSubmit={valor => {
              const texto = valor.trim().slice(0, 200)
              if (texto) void mudarProjeto($, p => comHistorico(
                { ...p, pendencias: [...p.pendencias, { id: novoId(), texto, feita: false, criada: agora() }] },
                `Pendência anotada: ${texto}`,
              ))
            }}
          />
        )}
        {feitas.length > 0 && (
          <Button
            key="limpar"
            label={`Limpar ${plural(feitas.length, 'concluída', 'concluídas')}`}
            plain
            dimColor
            onPress={() => void mudarProjeto($, p => ({ ...p, pendencias: p.pendencias.filter(x => !x.feita) }))}
          />
        )}

        {secao('Tempo no projeto')}
        <Text>
          Hoje {duracao(r.projeto.minutosHoje)} · Total {duracao(r.projeto.minutosTotal)}
        </Text>
        {valorTrabalho > 0 && !aj.editarValor && (
          <Box justifyContent="space-between">
            <Text color="success">
              ≈ R$ {Math.round(valorTrabalho).toLocaleString('pt-BR')} de trabalho (R$ {r.valorHora}/h)
            </Text>
            <Button key="trocar-valor" label="trocar" plain dimColor onPress={() => update($, ajustes, a => ({ ...a, editarValor: true }))} />
          </Box>
        )}
        {(r.valorHora === 0 || aj.editarValor) && Input && (
          <Input
            key="valor-hora"
            placeholder="Quanto vale sua hora? (ex.: 80)"
            submitLabel="Salvar"
            onSubmit={valor => {
              const n = Number(valor.replace(/[^\d.,]/g, '').replace(',', '.'))
              void update($, ajustes, a => ({ ...a, editarValor: false }))
              if (n > 0) void $.store.set('valorHora', n).then(() => atualizar($))
            }}
          />
        )}

        {r.projeto.historico.length > 0 && secao('Últimos acontecimentos')}
        {r.projeto.historico.slice(0, 5).map((fato: Acontecimento) => (
          <Text dimColor>• {rel(fato.t)}: {fato.texto}</Text>
        ))}
      </Box>
    )
  })
}
