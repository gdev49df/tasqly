#!/usr/bin/env python3
"""Прописывает мета-теги, canonical, Open Graph и текст для поисковиков в public/*.html,
а также пересоздаёт sitemap.xml и robots.txt. Домен меняется одной константой."""
import re, pathlib
SITE = 'https://tasqly.wsmp.workers.dev'
ROOT = pathlib.Path(__file__).resolve().parent.parent / 'public'
DESC = 'tasqly — задачи, доски, учёт времени, заметки, чат и файлы команды в одном пространстве. AI-помощник по задачам. Начать можно бесплатно.'
PAGES = {
  '': dict(title='tasqly — задачи, время и команда в одном пространстве', desc=DESC, index=True, prio='1.0',
           h1='Вся работа команды на одной доске',
           text='tasqly собирает задачи, учёт времени, заметки, чат и файлы в одном пространстве. AI подскажет, что горит, и разобьёт большую задачу на шаги. 5 дней «Команды» в подарок, регистрация за минуту, карта не нужна.'),
  'pricing': dict(title='Тарифы · tasqly', desc='Тарифы tasqly: «Старт» бесплатно, «Команда» 2 500 ₸ за человека в месяц, «Бизнес» по запросу. Сравнение планов и лимиты.', index=True, prio='0.8',
           h1='Тарифы под любой бюджет', text='Начни бесплатно и переходи дальше, когда команда вырастет. Старт — 0 ₸, Команда — 2 500 ₸ за человека в месяц (5 дней бесплатно), Бизнес — по запросу.'),
  'contacts': dict(title='Контакты · tasqly', desc='Контакты tasqly: вопросы по сервису, идеи, баги и условия для компаний.', index=True, prio='0.5',
           h1='Контакты', text='Пиши с вопросами по сервису, идеями и багами. Для компаний тариф «Бизнес» обсуждается лично.'),
  'register': dict(title='Регистрация · tasqly', desc='Создай пространство в tasqly за минуту. Карта не нужна.', index=True, prio='0.6',
           h1='Регистрация', text='Создай пространство в tasqly за минуту. Карта не нужна.'),
  'login': dict(title='Вход · tasqly', desc='Вход в tasqly.', index=False, h1='Вход', text='Войти в tasqly.'),
  'privacy': dict(title='Политика конфиденциальности · tasqly', desc='Политика конфиденциальности tasqly.', index=True, prio='0.2', h1='Политика конфиденциальности', text='Политика конфиденциальности tasqly.'),
  'terms': dict(title='Условия использования · tasqly', desc='Условия использования tasqly.', index=True, prio='0.2', h1='Условия использования', text='Условия использования tasqly.'),
  'panel': dict(title='Кабинет · tasqly', desc=DESC, index=False, h1='Кабинет tasqly', text='Войди, чтобы работать с задачами, временем, заметками и чатом.'),
}
GOOGLE = ['TFd_xlGrplHit-fv_AoYr6XhpIQHhYTs9C7gltcOTYs', 'qtTrhKQPrQRRudL47tVWaxlOJHF-p-8FdEcr2Ty45Uk']  # подтверждение Search Console, только главная
START, END = '<!-- seo:start -->', '<!-- seo:end -->'
def esc(s): return s.replace('&', '&amp;').replace('"', '&quot;').replace('<', '&lt;')
for slug, p in PAGES.items():
    f = ROOT / slug / 'index.html' if slug else ROOT / 'index.html'
    html = f.read_text(encoding='utf-8')
    url = f'{SITE}/{slug}/' if slug else f'{SITE}/'
    html = re.sub(r'\s*<title>.*?</title>', '', html, flags=re.S)
    html = re.sub(r'\s*<meta name="description"[^>]*>', '', html)
    html = re.sub(START + r'.*?' + END + r'\s*', '', html, flags=re.S)
    verify = ''.join(f'  <meta name="google-site-verification" content="{g}">\n' for g in GOOGLE) if not slug else ''
    block = f'''{START}
  <title>{esc(p['title'])}</title>
  <meta name="description" content="{esc(p['desc'])}">
  <meta name="robots" content="{'index, follow' if p['index'] else 'noindex, nofollow'}">
  <link rel="canonical" href="{url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="tasqly">
  <meta property="og:locale" content="ru_RU">
  <meta property="og:title" content="{esc(p['title'])}">
  <meta property="og:description" content="{esc(p['desc'])}">
  <meta property="og:url" content="{url}">
  <meta property="og:image" content="{SITE}/icon-512.png">
  <meta name="twitter:card" content="summary">
{verify}  {END}
  '''
    html = html.replace('<meta name="theme-color"', block + '<meta name="theme-color"', 1)
    nav = '<a href="/">Главная</a> <a href="/pricing">Тарифы</a> <a href="/contacts">Контакты</a> <a href="/register">Регистрация</a>'
    static = f'<main data-seo><h1>{esc(p["h1"])}</h1><p>{esc(p["text"])}</p><nav>{nav}</nav></main>'
    html = re.sub(r'<div id="app">.*?</div>', f'<div id="app">{static}</div>', html, count=1, flags=re.S)
    f.write_text(html, encoding='utf-8')
urls = ''.join(f'  <url><loc>{SITE}/{s}/</loc><priority>{p["prio"]}</priority></url>\n' if s else f'  <url><loc>{SITE}/</loc><priority>{p["prio"]}</priority></url>\n'
               for s, p in PAGES.items() if p['index'])
(ROOT / 'sitemap.xml').write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n')
(ROOT / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nDisallow: /panel/\nDisallow: /api/\n\nSitemap: {SITE}/sitemap.xml\n')
print('ok')
