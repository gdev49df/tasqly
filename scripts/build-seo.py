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
  'changelog': dict(title='Что нового · tasqly', desc='Что появилось в tasqly: роли, журнал действий, подтверждение почты, экспорт данных, поиск и многое другое.', index=True, prio='0.4',
           h1='Что нового', text='Что появилось в tasqly: подтверждение почты, журнал действий, экспорт данных и удаление аккаунта, роли участников, поиск, повторяющиеся задачи, голосовая задача.'),
  'status': dict(title='Статус сервиса · tasqly', desc='Живая проверка работы tasqly: сервис, база данных, резервные копии, AI.', index=False, h1='Статус сервиса', text='Живая проверка работы tasqly: сервис, база данных, резервные копии и AI-помощник.'),
  'task-tracker': dict(title='Таск-трекер для команды · tasqly', desc='Таск-трекер для небольшой команды: доска, список и календарь задач, сроки, исполнители, учёт времени, чат и файлы. Бесплатно до 3 человек.', index=True, prio='0.7',
           h1='Таск-трекер для небольшой команды', text='Задачи, сроки, учёт времени, заметки, чат и файлы в одном пространстве. Доска, список и календарь, исполнители, приоритеты, метки, чек-листы, роли участников, ссылка для клиента и AI-помощник. Работает в браузере на компьютере и телефоне. «Старт» бесплатный до 3 человек.'),
  'uchet-vremeni': dict(title='Учёт рабочего времени по задачам · tasqly', desc='Таймер в задаче, ручной ввод и отчёт по людям и проектам за 7, 30 или 90 дней. Учёт времени команды в tasqly.', index=True, prio='0.6',
           h1='Учёт рабочего времени по задачам', text='Включай таймер прямо в задаче или добавляй время вручную. Отчёт показывает, сколько ушло по людям и по проектам за 7, 30 или 90 дней. Таймер работает на всех тарифах.'),
  'perehod-s-trello': dict(title='Переезд с Trello: импорт досок · tasqly', desc='Как перенести доски из Trello в tasqly: экспорт в JSON и импорт за пару минут. Списки, карточки, метки, чек-листы и сроки переносятся автоматически.', index=True, prio='0.6',
           h1='Переезд с Trello в tasqly за пару минут', text='Скачай доску из Trello через «Печать и экспорт», «Экспорт в JSON» и загрузи файл в tasqly. Списки станут колонками, карточки задачами, метки, чек-листы и сроки сохранятся. Импорт бесплатный.'),
  'perehod-s-clickup': dict(title='Переезд с ClickUp: импорт задач из CSV · tasqly', desc='Как перенести задачи из ClickUp в tasqly: экспорт списка в CSV и импорт. Статусы, сроки, приоритеты, теги и подзадачи переносятся автоматически.', index=True, prio='0.6',
           h1='Переезд с ClickUp в tasqly', text='Выгрузи список задач из ClickUp в CSV и загрузи в tasqly. Статусы станут колонками, теги метками, подзадачи пунктами чек-листа, сроки и приоритеты сохранятся. Импорт бесплатный.'),
  'register': dict(title='Регистрация · tasqly', desc='Создай пространство в tasqly за минуту. Карта не нужна.', index=True, prio='0.6',
           h1='Регистрация', text='Создай пространство в tasqly за минуту. Карта не нужна.'),
  'login': dict(title='Вход · tasqly', desc='Вход в tasqly.', index=False, h1='Вход', text='Войти в tasqly.'),
  'privacy': dict(title='Политика конфиденциальности · tasqly', desc='Какие данные хранит tasqly, зачем, где и как ими управлять.', index=True, prio='0.2', h1='Политика конфиденциальности', text='Какие данные хранит tasqly: аккаунт, содержимое пространств, служебные данные. Где они хранятся, кому передаются, как удалить аккаунт и отозвать согласие. Редакция от 16 ноября 2026.'),
  'terms': dict(title='Условия использования · tasqly', desc='Правила использования tasqly: аккаунт, содержимое, тарифы, ответственность.', index=True, prio='0.2', h1='Условия использования', text='Правила использования tasqly: аккаунт, допустимое использование, содержимое пользователя, тарифы и оплата, AI-помощник, ответственность и прекращение использования.'),
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
  <meta property="og:image" content="{SITE}/og.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="{SITE}/og.jpg">
{verify}  {END}
  '''
    html = html.replace('<meta name="theme-color"', block + '<meta name="theme-color"', 1)
    nav = '<a href="/">Главная</a> <a href="/pricing">Тарифы</a> <a href="/task-tracker">Таск-трекер для команды</a> <a href="/uchet-vremeni">Учёт времени</a> <a href="/perehod-s-trello">Переезд с Trello</a> <a href="/perehod-s-clickup">Переезд с ClickUp</a> <a href="/contacts">Контакты</a> <a href="/register">Регистрация</a>'
    static = f'<main data-seo><h1>{esc(p["h1"])}</h1><p>{esc(p["text"])}</p><nav>{nav}</nav></main>'
    html = re.sub(r'<div id="app">.*?</div>', f'<div id="app">{static}</div>', html, count=1, flags=re.S)
    f.write_text(html, encoding='utf-8')
urls = ''.join(f'  <url><loc>{SITE}/{s}/</loc><priority>{p["prio"]}</priority></url>\n' if s else f'  <url><loc>{SITE}/</loc><priority>{p["prio"]}</priority></url>\n'
               for s, p in PAGES.items() if p['index'])
(ROOT / 'sitemap.xml').write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n')
(ROOT / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nDisallow: /panel/\nDisallow: /api/\n\nSitemap: {SITE}/sitemap.xml\n')
print('ok')
