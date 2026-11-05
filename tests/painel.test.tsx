import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'painel-projeto',
  component: 'Pane',
  requestId: 'painel-projeto',
  props: {
    title: 'Painel do Projeto',
    isFocused: false,
    bodyColumns: 48,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const agora = Date.now()

const RETRATO = {
  pasta: 'C:/Users/x/Desktop/app-do-cliente',
  nome: 'app-do-cliente',
  projeto: {
    marcas: { plano: agora - 3 * 86_400_000 },
    pendencias: [
      { id: 'a', texto: 'Trocar a foto da página inicial', feita: false, criada: agora },
      { id: 'b', texto: 'Botão de WhatsApp', feita: true, criada: agora },
    ],
    minutosTotal: 312,
    dia: '2026-11-05',
    minutosHoje: 47,
    linkApp: 'https://app.exemplo.com',
    historico: [{ t: agora - 60_000, texto: 'Backup criado (103)' }],
  },
  git: {
    temGit: true,
    branch: 'main',
    alterados: 7,
    ultimoCommit: { t: agora - 2 * 3_600_000, msg: 'versão 3' },
    remoto: 'https://github.com/x/app-do-cliente',
    temUpstream: true,
    aFrente: 0,
  },
  temPlano: true,
  temCodigo: true,
  valorHora: 80,
  lidoEm: agora,
}

test('o painel mostra o fluxo, o próximo passo e as pendências', async ($, on) => {
  on('state.get', (_, e) => {
    const chave = (e as unknown as { key: string }).key
    if (chave === 'retrato') return { value: { value: { shape: 'retrato-1', value: RETRATO }, version: 1 } }

    return { value: { value: { editarValor: false, editarLink: false }, version: 1 } }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /app-do-cliente/ })).toBeDefined()
    expect(await ui.find({ key: 'proximo' })).toBeDefined()
    expect((await ui.find({ key: 'proximo' }))?.text).toContain('103')
    expect(await ui.find({ key: 'p-a' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /R\$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('sem nada guardado, o painel diz que está lendo', async ($, on) => {
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text' }))?.text).toBe('Lendo o projeto…')
    await ui.unmount()
  }
})
