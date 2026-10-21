// Workspace files for the browser tests, and the source of the README screenshots.

export const README = [
  "# Fixture workspace",
  "",
  "Open the [demo document](docs/demo.md) or the [notes](notes/other.markdown).",
  "",
].join("\n");

export const OTHER = String.raw`# Other notes

Euler: $e^{i\pi} + 1 = 0$.
`;

// "‵" stands in for a backtick, which String.raw cannot hold.
export const DEMO = String.raw`---
title: RaTeX Markdown demo
tags:
  - math
  - paseo
---

# Typesetting math in Paseo

RaTeX lays out **LaTeX** inside Markdown. Inline formulas such as $e^{i\pi} + 1 = 0$,
$\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$ and \(\nabla \cdot \vec E = \frac{\rho}{\varepsilon_0}\)
sit on the text baseline.

## Display math

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

\[
\mathbf{A} = \begin{pmatrix} a_{11} & a_{12} \\ a_{21} & a_{22} \end{pmatrix}, \quad \det \mathbf{A} = a_{11}a_{22} - a_{12}a_{21}
\]

~~~math
f(x) = \begin{cases} x^2 & x \ge 0 \\ -x & x < 0 \end{cases}
~~~

A wide equation scrolls sideways:

$$
\left(\sum_{i=1}^{n} a_i b_i\right)^2 \le \left(\sum_{i=1}^{n} a_i^2\right)\left(\sum_{i=1}^{n} b_i^2\right) \quad\text{and}\quad \lim_{n\to\infty}\left(1+\frac{1}{n}\right)^{n} = e \quad\text{and}\quad \oint_{\partial S} \vec F \cdot d\vec r = \iint_S (\nabla \times \vec F)\cdot d\vec S
$$

## Everything else Markdown has

- [x] Lists keep their math: $O(n \log n)$
- [ ] Chemistry with mhchem: $\ce{2H2 + O2 -> 2H2O}$
- Prices like $5 and $10 stay text.

> **Note.** Quotes hold math too: $\hat{\theta} = \arg\max_\theta \mathcal{L}(\theta)$.

| Distribution | Mean | Variance |
| :-- | :-: | --: |
| Normal $\mathcal{N}(\mu, \sigma^2)$ | $\mu$ | $\sigma^2$ |
| Poisson $\mathrm{Pois}(\lambda)$ | $\lambda$ | $\lambda$ |

~~~python
def gaussian(x, mu=0.0, sigma=1.0):
    return math.exp(-((x - mu) / sigma) ** 2 / 2) / (sigma * math.sqrt(2 * math.pi))
~~~

Inline ‵code‵, ~~strikethrough~~, a [link](https://paseo.sh) and a footnote[^ratex].

![A plot of two waves](img/plot.png "Figure 1")

An invalid formula shows its source: $\frac{1}{$.

[^ratex]: RaTeX is a KaTeX-compatible math engine written in Rust.
`.replaceAll("‵", "`");

export const PLOT_PNG_BASE64 =
  "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";
