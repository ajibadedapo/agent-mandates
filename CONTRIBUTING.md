# Contributing to Agent Mandates

Agent Mandates is a framework, not a tool. Most contributions are evidence and argument: real incidents, mappings to products and standards, and challenges to the principles. All of them are welcome.

By contributing, you agree that your contribution is licensed under [CC BY 4.0](LICENSE), the same licence as the framework.

## Ways to contribute

### Report an incident pattern

Have you seen an agent do something it should not have, or something nearly go wrong? Open an [incident pattern](https://github.com/ajibadedapo/agent-mandates/issues/new?template=incident-pattern.yml) issue.

- Describe what the agent did, what it was meant to do, and what it ran as.
- Name the principle or audit check that would have prevented it, or say that none would.
- Remove names, secrets and anything identifying a person or organisation unless it is already public.

Patterns that no principle covers are the most useful reports.

### Add an implementation mapping

Show how a product, protocol or standard meets (or does not meet) the framework. Open a [mapping](https://github.com/ajibadedapo/agent-mandates/issues/new?template=mapping.yml) issue.

- Say which of the eight mandate fields, six principles and seven audit checks it covers.
- Give the maturity level (0 to 3) you think it reaches and why.
- Link the public documentation you relied on.

Mappings are factual, not reviews. Note what is missing as plainly as what is present.

### Propose a principle change

The principles are meant to stay stable, so changes need a clear case. Open a [principle change](https://github.com/ajibadedapo/agent-mandates/issues/new?template=principle-change.yml) issue.

- Quote the text you want changed and give your proposed wording.
- Explain the failure the current text allows, or the cost it imposes, with an example.
- Say whether it changes a MUST, a SHOULD, a maturity level or an audit check.

Discuss in the issue first. A pull request is welcome once the change is agreed.

## Pull requests

- Keep each pull request to one change.
- Use plain British English and short sentences.
- Use MUST and SHOULD only for requirements, as the rest of the README does.
- Link the issue the change came from.

## Conduct

Be direct and be kind. Argue with ideas, not people.
