/**
 * A local stand-in for the Formula Jon homepage, so ADI can be previewed
 * without touching the live WordPress site. Colours and type match the
 * theme CSS captured on 13 November 2026.
 */

export function adiPreviewHtml(): string {
  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Formula Jon Driving School — ADI preview</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Raleway:wght@600;700;800&family=Roboto:wght@400;500;700&display=swap">
  <style>
    :root {
      --theme-color: #E01609;
      --title-color: #191825;
      --body-color: #54595F;
      --smoke-color: #F7F7F7;
      --border-color: #E6E6E6;
      --white-color: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Roboto, "Segoe UI", sans-serif;
      color: var(--title-color);
      background: var(--white-color);
      line-height: 1.5;
    }
    a { color: inherit; }
    .top {
      background: var(--title-color);
      color: var(--white-color);
      font-size: 14px;
    }
    .top-inner, .nav-inner, .wrap { width: min(1100px, calc(100% - 32px)); margin: 0 auto; }
    .top-inner, .nav-inner { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
    .top-inner { padding: 12px 0; }
    .notice { margin: 0; font-weight: 700; }
    .phones { margin: 0; }
    .nav { background: var(--theme-color); color: var(--white-color); }
    .nav-inner { padding: 14px 0; }
    .brand { font-family: Raleway, Roboto, sans-serif; font-weight: 800; letter-spacing: 0.02em; font-size: 22px; }
    .brand span { display: block; font-weight: 700; font-size: 12px; letter-spacing: 0.14em; }
    .links { display: flex; gap: 18px; align-items: center; font-weight: 700; font-size: 14px; }
    .book {
      background: var(--white-color);
      color: var(--theme-color);
      text-decoration: none;
      padding: 10px 16px;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 13px;
      letter-spacing: 0.04em;
    }
    .hero { padding: 64px 0 72px; }
    .kicker { color: var(--theme-color); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-size: 13px; margin: 0 0 8px; }
    h1 { font-family: Raleway, Roboto, sans-serif; font-weight: 800; font-size: clamp(36px, 6vw, 64px); line-height: 0.95; margin: 0 0 16px; }
    .lede { max-width: 38rem; color: var(--body-color); font-size: 18px; }
    .band { background: var(--smoke-color); padding: 48px 0 80px; }
    h2 { font-family: Raleway, Roboto, sans-serif; font-size: 32px; margin: 0 0 8px; }
    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 24px; }
    .card { background: var(--white-color); border: 1px solid var(--border-color); padding: 20px; }
    .card h3 { font-family: Raleway, Roboto, sans-serif; margin: 0 0 8px; font-size: 20px; }
    .price { color: var(--theme-color); font-family: Raleway, Roboto, sans-serif; font-weight: 800; font-size: 28px; margin: 0 0 8px; }
    .card p { margin: 0; color: var(--body-color); }
    .preview-note { margin-top: 28px; font-size: 13px; color: var(--body-color); }
    @media (max-width: 800px) {
      .top-inner, .nav-inner { flex-direction: column; align-items: flex-start; }
      .links { display: none; }
      .cards { grid-template-columns: 1fr; }
      .hero { padding: 36px 0 48px; }
    }
  </style>
</head>
<body>
  <header>
    <div class="top">
      <div class="top-inner">
        <p class="notice">Free driving controls lesson for new pupils</p>
        <p class="phones">07790 779 687 (Sutton) · 0330 043 6002 (Reigate)</p>
      </div>
    </div>
    <div class="nav">
      <div class="nav-inner">
        <div class="brand">Formula Jon<span>DRIVING SCHOOL</span></div>
        <nav class="links" aria-label="Preview">
          <span>Lessons</span>
          <span>Prices</span>
          <span>Areas</span>
          <a class="book" href="https://www.formulajondrivingschool.co.uk/book">Book lessons</a>
        </nav>
      </div>
    </div>
  </header>
  <main>
    <section class="hero">
      <div class="wrap">
        <p class="kicker">Fast lane to success</p>
        <h1>Learn to drive with confidence</h1>
        <p class="lede">Manual and automatic lessons in Sutton, Carshalton, Wallington and across south London and Surrey. This page is a local preview so you can try ADI. It is not the live Formula Jon website.</p>
      </div>
    </section>
    <section class="band">
      <div class="wrap">
        <h2>Popular lessons</h2>
        <p>Manual and automatic lessons cost the same. Prices below are the ones published for SM, CR and KT postcodes.</p>
        <div class="cards">
          <article class="card">
            <h3>Pay as you go</h3>
            <p class="price">£39</p>
            <p>An hour in the SM, CR and KT postcodes. £38 an hour on a 10-hour block.</p>
          </article>
          <article class="card">
            <h3>2 hours</h3>
            <p class="price">£78</p>
            <p>A short block for SM, CR and KT. RH postcodes are £40 an hour.</p>
          </article>
          <article class="card">
            <h3>Free controls lesson</h3>
            <p class="price">30 min</p>
            <p>New pupils start with a free controls lesson, deducted from their first lesson.</p>
          </article>
        </div>
        <p class="preview-note">Preview only. ADI sits at the bottom left. Nothing on this page is installed on formulajondrivingschool.co.uk.</p>
      </div>
    </section>
  </main>
  <script src="/adi/widget.js" defer></script>
</body>
</html>`;
}
