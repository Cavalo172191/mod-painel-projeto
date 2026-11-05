# Painel do Projeto

Um mod para o Claude que mostra o projeto do cliente aberto num painel fixo ao lado da conversa. Ele foi feito para quem constrói apps seguindo o fluxo Genesis da mentoria Fábrica de Apps.

## O problema

Quem atende vários clientes abre a pasta de um app e precisa lembrar onde parou: o plano já foi feito? O que mudou desde o último backup? A última versão já foi publicada? O que ficou pendente? Hoje isso fica na cabeça, ou se descobre perguntando ao Claude e rodando comandos de git. Um esquecimento de backup ou de publicação custa retrabalho e desgasta a relação com o cliente.

## O que o painel mostra

- **Fluxo do app**: Plano (110), Construção (106), Backup (103) e Publicado (108), cada etapa com ✅, ⚠️ ou ⬜, lidas da própria pasta e do Git.
- **Próximo passo**: um botão que manda o atalho certo para o Claude, como se você digitasse `103`.
- **No ar**: o link do GitHub e o link do app publicado (Easypanel).
- **Pendências**: o Claude anota sozinho o que ficou para depois, e você marca como feito com um clique.
- **Tempo no projeto**: o tempo de hoje e o total trabalhado com o Claude, e quanto isso vale em R$ pela sua hora.
- **Aviso automático**: um alerta quando há arquivos alterados sem backup há mais de 30 minutos, ou uma versão salva que o cliente ainda não vê.

## Como instalar

No prompt de uma sessão do Claude Code no terminal:

```
/plugin install painel-projeto --marketplace Cavalo172191/mod-painel-projeto
```

Responda `y` para adicionar o marketplace e escolha o escopo (o de usuário vem primeiro, é só dar Enter).

Pelo shell:

```
claude plugin install painel-projeto --marketplace Cavalo172191/mod-painel-projeto
```

No app desktop, onde `/plugin` não roda: clique no + ao lado da caixa do prompt, depois em Plugins, em Add marketplace com `Cavalo172191/mod-painel-projeto` e, por fim, em Add plugin.

## Como usar

O painel abre sozinho ao iniciar a sessão. Se você o fechar, digite `/painel`. Abra a sessão na pasta do app (por exemplo `Desktop\nome-do-app`).

## Licença

MIT
