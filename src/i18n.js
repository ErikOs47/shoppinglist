// Übersetzungen der App-Texte. Produktnamen und eigene Kategorien sind
// Nutzerdaten und werden nicht übersetzt; die von der App vorgegebenen
// Kategorien werden nur in der Anzeige übersetzt (gespeichert bleibt der
// deutsche Name, damit beide Personen dieselben Daten haben).
//
// Neue Sprache: Eintrag in LANGUAGES, Wörterbuch in DICT und Kategorienamen
// in CATEGORY_NAMES ergänzen. Der Test tests/unit/i18n.test.js prüft, dass
// keine Texte fehlen.

export const LANGUAGES = [
  { code: 'de', name: 'Deutsch' },
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Português' }, // europäisches Portugiesisch (pt-PT), Anrede „tu“
];

const plural = (n, one, many) => (n === 1 ? one : many);

const de = {
  appName: 'Einkauf',
  loading: 'Lade …',
  retry: 'Erneut versuchen',
  logout: 'Abmelden',
  cancel: 'Abbrechen',
  ok: 'OK',
  done: 'Fertig',
  name: 'Name',

  'fatal.start': 'Fehler beim Start',
  'fatal.notConfigured': 'Nicht eingerichtet',
  'fatal.notConfiguredText': 'VITE_SUPABASE_URL und VITE_SUPABASE_ANON_KEY fehlen. Siehe SETUP.md.',
  'fatal.badUrl': 'Falsche Supabase-Einstellung',
  'fatal.badUrlText': '{msg} – VITE_SUPABASE_URL muss so aussehen: https://xxxx.supabase.co (siehe SETUP.md, Schritt 4).',
  'load.offline': 'Keine Verbindung',
  'load.offlineText': 'Beim ersten Start wird eine Internetverbindung gebraucht.',
  'load.error': 'Fehler beim Laden',

  'auth.tagline': 'Gemeinsame Einkaufsliste',
  'auth.createAccount': 'Konto erstellen',
  'auth.email': 'E-Mail',
  'auth.password': 'Passwort',
  'auth.minChars': 'Mindestens 6 Zeichen.',
  'auth.register': 'Registrieren',
  'auth.login': 'Anmelden',
  'auth.haveAccount': 'Ich habe schon ein Konto',
  'auth.newAccount': 'Neues Konto erstellen',
  'auth.missing': 'Bitte E-Mail und Passwort eingeben.',
  'auth.confirmMail': 'Fast fertig: Bitte bestätige deine E-Mail über den Link im Postfach und melde dich dann an.',
  'auth.wrongCredentials': 'E-Mail oder Passwort falsch.',
  'auth.exists': 'Für diese E-Mail gibt es schon ein Konto.',
  'auth.notConfirmed': 'Bitte zuerst die E-Mail bestätigen (Link im Postfach).',
  'auth.passwordShort': 'Das Passwort ist zu kurz.',
  'auth.rateLimit': 'Zu viele Versuche. Bitte kurz warten.',
  'auth.unknown': 'Unbekannter Fehler.',

  'setup.title': 'Haushalt',
  'setup.lead': 'Lege einen Haushalt an oder tritt dem deines Partners bei.',
  'setup.namePlaceholder': 'z. B. Zuhause',
  'setup.create': 'Haushalt anlegen',
  'setup.or': 'ODER',
  'setup.code': 'Code',
  'setup.codePlaceholder': 'Einladungscode',
  'setup.join': 'Beitreten',
  'setup.logoutAs': 'Abmelden ({email})',
  'setup.nameMissing': 'Bitte einen Namen eingeben.',
  'setup.codeMissing': 'Bitte den Einladungscode eingeben.',

  'tab.products': 'Produkte',
  'tab.list': 'Einkaufszettel',
  'nav.settings': 'Einstellungen',
  'nav.addProduct': 'Produkt hinzufügen',
  'nav.edit': 'Bearbeiten',
  'search.placeholder': 'Suchen oder neu anlegen',
  'search.label': 'Produkte durchsuchen',
  'search.clear': 'Suche leeren',

  'sync.offline': 'Offline',
  'sync.pending': ({ n }) => `${n} ${plural(n, 'Änderung wartet', 'Änderungen warten')}`,
  'sync.syncing': 'Synchronisiere …',
  'sync.connecting': 'Verbinde …',
  'sync.live': 'Live',

  'filter.label': 'Filter',
  'filter.all': 'Alle',
  'filter.favorites': 'Favoriten',
  'products.quickAdd': '„{q}“ als Produkt anlegen',
  'products.emptyFavTitle': 'Noch keine Favoriten',
  'products.emptyFavText': 'Tippe bei einem Produkt auf den Stern, um es hier zu sammeln.',
  'products.emptyTitle': 'Noch keine Produkte',
  'products.emptyText': 'Tippe oben auf + oder suche nach einem Produkt, um es anzulegen.',
  'products.noResults': 'Kein Produkt gefunden.',
  'products.onList': ', auf dem Zettel',
  'products.editLabel': '{name} bearbeiten',
  'products.favAdd': '{name} als Favorit markieren',
  'products.favRemove': '{name} nicht mehr als Favorit markieren',
  'products.deleted': '„{name}“ gelöscht',

  'list.removeLabel': '{name} vom Zettel entfernen',
  'list.moveLabel': '{name} verschieben',
  'list.suggestions': 'Vorschläge',
  'list.oftenBought': 'Oft gekauft',
  'list.suggestAdd': '{name} auf den Zettel',
  'list.emptyTitle': 'Der Zettel ist leer',
  'list.emptyText': 'Wähle im Tab „Produkte“ aus, was du brauchst.',
  'list.counter': ({ open, done }) => `${open} offen · ${done} im Wagen`,
  'list.counterLabel': ({ open, done }) => `${open} offen, ${done} im Wagen`,
  'list.inCart': 'Im Einkaufswagen',
  'list.finishButton': 'Einkauf abschließen ({n})',

  'finish.title': 'Einkauf abschließen?',
  'finish.message': ({ done, open }) =>
    `${done} abgehakte ${plural(done, 'Artikel wird', 'Artikel werden')} vom Zettel entfernt.` +
    (open ? ` ${open} nicht gekaufte ${plural(open, 'bleibt', 'bleiben')} stehen.` : ''),
  'finish.confirm': 'Abschließen',
  'finish.toast': 'Einkauf abgeschlossen',

  'product.new': 'Neues Produkt',
  'product.edit': 'Produkt bearbeiten',
  'product.add': 'Hinzufügen',
  'product.save': 'Sichern',
  'product.namePlaceholder': 'z. B. Hafermilch',
  'product.category': 'Kategorie',
  'product.newCategory': 'Neu',
  'product.newCategoryOption': 'Neue Kategorie …',
  'product.newCategoryPlaceholder': 'Name der Kategorie',
  'product.addToListNow': 'Gleich auf den Einkaufszettel',
  'product.removeFromList': 'Vom Zettel nehmen',
  'product.addToList': 'Auf den Zettel',
  'product.delete': 'Produkt löschen',
  'product.deleteTitle': '„{name}“ löschen?',
  'product.deleteText': 'Das Produkt wird für beide aus der Datenbank und vom Zettel entfernt.',
  'product.deleteConfirm': 'Löschen',
  'product.errNameMissing': 'Bitte einen Namen eingeben.',
  'product.errNameLong': 'Der Name ist zu lang (max. 80 Zeichen).',
  'product.errCategoryMissing': 'Bitte eine Kategorie wählen.',
  'product.errCategoryLong': 'Die Kategorie ist zu lang (max. 40 Zeichen).',
  'product.errExists': '„{name}“ gibt es schon.',

  'settings.title': 'Einstellungen',
  'settings.household': 'Haushalt',
  'settings.members': 'Mitglieder: {n} von 2',
  'settings.inviteHint': 'Einladungscode für deinen Partner:',
  'settings.share': 'Code teilen',
  'settings.shareText': 'Tritt meinem Einkaufs-Haushalt bei. Code: {code}',
  'settings.codeCopied': 'Code kopiert',
  'settings.nameSaved': 'Name gespeichert',
  'settings.loggedInAs': 'Angemeldet als {email}',
  'settings.language': 'Sprache',
  'settings.languageHint': 'Gilt nur für dein Konto, nicht für den ganzen Haushalt.',
  'settings.languageLocalOnly': 'Sprache vorerst nur auf diesem Gerät gespeichert (keine Verbindung).',

  'logout.pendingTitle': 'Noch nicht synchronisiert',
  'logout.pendingText': ({ n }) =>
    `${n} ${plural(n, 'Änderung ist', 'Änderungen sind')} noch nicht beim Server. Sie bleiben auf diesem Gerät gespeichert und werden nach der nächsten Anmeldung gesendet.`,
  'logout.pendingConfirm': 'Trotzdem abmelden',

  'err.network': 'Netzwerkfehler',
  'err.noConnection': 'Keine Verbindung zum Server.',
  'err.noPermission': 'Keine Berechtigung für diese Aktion.',
  'err.invalidInput': 'Eingabe ungültig (zu lang oder leer).',
  'err.dbNotSetUp':
    'Die Datenbank ist nicht eingerichtet. Bitte in Supabase im SQL Editor die Datei supabase/migrations/20261121000000_init.sql ausführen (SETUP.md, Schritt 3).',
  'err.load': 'Laden fehlgeschlagen',
  'err.saveProduct': 'Produkt konnte nicht gespeichert werden',
  'err.updateProduct': 'Produkt konnte nicht geändert werden',
  'err.deleteProduct': 'Produkt konnte nicht gelöscht werden',
  'err.addToList': 'Konnte nicht auf den Zettel gesetzt werden',
  'err.removeFromList': 'Konnte nicht vom Zettel entfernt werden',
  'err.check': 'Haken konnte nicht gesetzt werden',
  'err.finish': 'Einkauf konnte nicht abgeschlossen werden',
  'err.move': 'Reihenfolge konnte nicht gespeichert werden',
  'err.favorite': 'Favorit konnte nicht gespeichert werden',
  'err.unknownOp': 'Unbekannte Operation {type}',
  'err.storageCorrupt': 'Lokaler Speicher war beschädigt und wurde zurückgesetzt.',
  'err.storageWrite': 'Änderungen konnten nicht lokal gespeichert werden.',
  'err.rejected': 'Änderung wurde vom Server abgelehnt.',
};

const en = {
  appName: 'Einkauf',
  loading: 'Loading …',
  retry: 'Try again',
  logout: 'Sign out',
  cancel: 'Cancel',
  ok: 'OK',
  done: 'Done',
  name: 'Name',

  'fatal.start': 'Error on start',
  'fatal.notConfigured': 'Not set up',
  'fatal.notConfiguredText': 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are missing. See SETUP.md.',
  'fatal.badUrl': 'Wrong Supabase setting',
  'fatal.badUrlText': '{msg} – VITE_SUPABASE_URL must look like this: https://xxxx.supabase.co (see SETUP.md, step 4).',
  'load.offline': 'No connection',
  'load.offlineText': 'An internet connection is needed for the first start.',
  'load.error': 'Error while loading',

  'auth.tagline': 'Shared shopping list',
  'auth.createAccount': 'Create account',
  'auth.email': 'Email',
  'auth.password': 'Password',
  'auth.minChars': 'At least 6 characters.',
  'auth.register': 'Sign up',
  'auth.login': 'Sign in',
  'auth.haveAccount': 'I already have an account',
  'auth.newAccount': 'Create new account',
  'auth.missing': 'Please enter email and password.',
  'auth.confirmMail': 'Almost done: please confirm your email using the link in your inbox, then sign in.',
  'auth.wrongCredentials': 'Wrong email or password.',
  'auth.exists': 'An account with this email already exists.',
  'auth.notConfirmed': 'Please confirm your email first (link in your inbox).',
  'auth.passwordShort': 'The password is too short.',
  'auth.rateLimit': 'Too many attempts. Please wait a moment.',
  'auth.unknown': 'Unknown error.',

  'setup.title': 'Household',
  'setup.lead': 'Create a household or join your partner’s.',
  'setup.namePlaceholder': 'e.g. Home',
  'setup.create': 'Create household',
  'setup.or': 'OR',
  'setup.code': 'Code',
  'setup.codePlaceholder': 'Invite code',
  'setup.join': 'Join',
  'setup.logoutAs': 'Sign out ({email})',
  'setup.nameMissing': 'Please enter a name.',
  'setup.codeMissing': 'Please enter the invite code.',

  'tab.products': 'Products',
  'tab.list': 'Shopping list',
  'nav.settings': 'Settings',
  'nav.addProduct': 'Add product',
  'nav.edit': 'Edit',
  'search.placeholder': 'Search or add new',
  'search.label': 'Search products',
  'search.clear': 'Clear search',

  'sync.offline': 'Offline',
  'sync.pending': ({ n }) => `${n} ${plural(n, 'change waiting', 'changes waiting')}`,
  'sync.syncing': 'Syncing …',
  'sync.connecting': 'Connecting …',
  'sync.live': 'Live',

  'filter.label': 'Filter',
  'filter.all': 'All',
  'filter.favorites': 'Favorites',
  'products.quickAdd': 'Add “{q}” as a product',
  'products.emptyFavTitle': 'No favorites yet',
  'products.emptyFavText': 'Tap the star on a product to collect it here.',
  'products.emptyTitle': 'No products yet',
  'products.emptyText': 'Tap + above or search for a product to add it.',
  'products.noResults': 'No product found.',
  'products.onList': ', on the list',
  'products.editLabel': 'Edit {name}',
  'products.favAdd': 'Mark {name} as favorite',
  'products.favRemove': 'Unmark {name} as favorite',
  'products.deleted': '“{name}” deleted',

  'list.removeLabel': 'Remove {name} from the list',
  'list.moveLabel': 'Move {name}',
  'list.suggestions': 'Suggestions',
  'list.oftenBought': 'Often bought',
  'list.suggestAdd': 'Add {name} to the list',
  'list.emptyTitle': 'The list is empty',
  'list.emptyText': 'Pick what you need in the “Products” tab.',
  'list.counter': ({ open, done }) => `${open} open · ${done} in cart`,
  'list.counterLabel': ({ open, done }) => `${open} open, ${done} in cart`,
  'list.inCart': 'In the cart',
  'list.finishButton': 'Finish shopping ({n})',

  'finish.title': 'Finish shopping?',
  'finish.message': ({ done, open }) =>
    `${done} checked ${plural(done, 'item', 'items')} will be removed from the list.` +
    (open ? ` ${open} unbought ${plural(open, 'item stays', 'items stay')}.` : ''),
  'finish.confirm': 'Finish',
  'finish.toast': 'Shopping finished',

  'product.new': 'New product',
  'product.edit': 'Edit product',
  'product.add': 'Add',
  'product.save': 'Save',
  'product.namePlaceholder': 'e.g. Oat milk',
  'product.category': 'Category',
  'product.newCategory': 'New',
  'product.newCategoryOption': 'New category …',
  'product.newCategoryPlaceholder': 'Category name',
  'product.addToListNow': 'Add to shopping list right away',
  'product.removeFromList': 'Remove from list',
  'product.addToList': 'Add to list',
  'product.delete': 'Delete product',
  'product.deleteTitle': 'Delete “{name}”?',
  'product.deleteText': 'The product will be removed from the database and the list for both of you.',
  'product.deleteConfirm': 'Delete',
  'product.errNameMissing': 'Please enter a name.',
  'product.errNameLong': 'The name is too long (max. 80 characters).',
  'product.errCategoryMissing': 'Please choose a category.',
  'product.errCategoryLong': 'The category is too long (max. 40 characters).',
  'product.errExists': '“{name}” already exists.',

  'settings.title': 'Settings',
  'settings.household': 'Household',
  'settings.members': 'Members: {n} of 2',
  'settings.inviteHint': 'Invite code for your partner:',
  'settings.share': 'Share code',
  'settings.shareText': 'Join my shopping household. Code: {code}',
  'settings.codeCopied': 'Code copied',
  'settings.nameSaved': 'Name saved',
  'settings.loggedInAs': 'Signed in as {email}',
  'settings.language': 'Language',
  'settings.languageHint': 'Applies only to your account, not the whole household.',
  'settings.languageLocalOnly': 'Language saved on this device only for now (no connection).',

  'logout.pendingTitle': 'Not synced yet',
  'logout.pendingText': ({ n }) =>
    `${n} ${plural(n, 'change has', 'changes have')} not reached the server yet. ${plural(n, 'It stays', 'They stay')} saved on this device and will be sent after your next sign-in.`,
  'logout.pendingConfirm': 'Sign out anyway',

  'err.network': 'Network error',
  'err.noConnection': 'No connection to the server.',
  'err.noPermission': 'Not allowed to do this.',
  'err.invalidInput': 'Invalid input (too long or empty).',
  'err.dbNotSetUp':
    'The database is not set up. Please run supabase/migrations/20261121000000_init.sql in the Supabase SQL Editor (SETUP.md, step 3).',
  'err.load': 'Loading failed',
  'err.saveProduct': 'Product could not be saved',
  'err.updateProduct': 'Product could not be changed',
  'err.deleteProduct': 'Product could not be deleted',
  'err.addToList': 'Could not add to the list',
  'err.removeFromList': 'Could not remove from the list',
  'err.check': 'Could not check the item',
  'err.finish': 'Could not finish shopping',
  'err.move': 'Order could not be saved',
  'err.favorite': 'Favorite could not be saved',
  'err.unknownOp': 'Unknown operation {type}',
  'err.storageCorrupt': 'Local storage was damaged and has been reset.',
  'err.storageWrite': 'Changes could not be saved locally.',
  'err.rejected': 'The server rejected the change.',
};

// Europäisches Portugiesisch (pt-PT): Anrede „tu“, Begriffe aus Portugal
// (palavra-passe, guardar, eliminar, definições, ecrã).
const pt = {
  appName: 'Einkauf',
  loading: 'A carregar …',
  retry: 'Tentar novamente',
  logout: 'Terminar sessão',
  cancel: 'Cancelar',
  ok: 'OK',
  done: 'Concluído',
  name: 'Nome',

  'fatal.start': 'Erro ao iniciar',
  'fatal.notConfigured': 'Não configurado',
  'fatal.notConfiguredText': 'Faltam VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY. Consulta o SETUP.md.',
  'fatal.badUrl': 'Configuração do Supabase incorreta',
  'fatal.badUrlText': '{msg} – VITE_SUPABASE_URL tem de ter este formato: https://xxxx.supabase.co (ver SETUP.md, passo 4).',
  'load.offline': 'Sem ligação',
  'load.offlineText': 'Na primeira utilização é necessária uma ligação à internet.',
  'load.error': 'Erro ao carregar',

  'auth.tagline': 'Lista de compras partilhada',
  'auth.createAccount': 'Criar conta',
  'auth.email': 'E-mail',
  'auth.password': 'Palavra-passe',
  'auth.minChars': 'Pelo menos 6 caracteres.',
  'auth.register': 'Registar',
  'auth.login': 'Iniciar sessão',
  'auth.haveAccount': 'Já tenho conta',
  'auth.newAccount': 'Criar nova conta',
  'auth.missing': 'Introduz o e-mail e a palavra-passe.',
  'auth.confirmMail': 'Quase pronto: confirma o teu e-mail através da ligação na caixa de entrada e depois inicia sessão.',
  'auth.wrongCredentials': 'E-mail ou palavra-passe incorretos.',
  'auth.exists': 'Já existe uma conta com este e-mail.',
  'auth.notConfirmed': 'Confirma primeiro o teu e-mail (ligação na caixa de entrada).',
  'auth.passwordShort': 'A palavra-passe é demasiado curta.',
  'auth.rateLimit': 'Demasiadas tentativas. Aguarda um momento.',
  'auth.unknown': 'Erro desconhecido.',

  'setup.title': 'Casa',
  'setup.lead': 'Cria uma casa ou junta-te à do teu parceiro.',
  'setup.namePlaceholder': 'p. ex. Casa',
  'setup.create': 'Criar casa',
  'setup.or': 'OU',
  'setup.code': 'Código',
  'setup.codePlaceholder': 'Código de convite',
  'setup.join': 'Aderir',
  'setup.logoutAs': 'Terminar sessão ({email})',
  'setup.nameMissing': 'Introduz um nome.',
  'setup.codeMissing': 'Introduz o código de convite.',

  'tab.products': 'Produtos',
  'tab.list': 'Lista de compras',
  'nav.settings': 'Definições',
  'nav.addProduct': 'Adicionar produto',
  'nav.edit': 'Editar',
  'search.placeholder': 'Pesquisar ou adicionar',
  'search.label': 'Pesquisar produtos',
  'search.clear': 'Limpar pesquisa',

  'sync.offline': 'Offline',
  'sync.pending': ({ n }) => `${n} ${plural(n, 'alteração pendente', 'alterações pendentes')}`,
  'sync.syncing': 'A sincronizar …',
  'sync.connecting': 'A ligar …',
  'sync.live': 'Em direto',

  'filter.label': 'Filtro',
  'filter.all': 'Todos',
  'filter.favorites': 'Favoritos',
  'products.quickAdd': 'Adicionar «{q}» como produto',
  'products.emptyFavTitle': 'Ainda sem favoritos',
  'products.emptyFavText': 'Toca na estrela de um produto para o juntar aqui.',
  'products.emptyTitle': 'Ainda sem produtos',
  'products.emptyText': 'Toca em + em cima ou pesquisa um produto para o adicionar.',
  'products.noResults': 'Nenhum produto encontrado.',
  'products.onList': ', na lista',
  'products.editLabel': 'Editar {name}',
  'products.favAdd': 'Marcar {name} como favorito',
  'products.favRemove': 'Desmarcar {name} como favorito',
  'products.deleted': '«{name}» eliminado',

  'list.removeLabel': 'Retirar {name} da lista',
  'list.moveLabel': 'Mover {name}',
  'list.suggestions': 'Sugestões',
  'list.oftenBought': 'Compras frequentes',
  'list.suggestAdd': 'Adicionar {name} à lista',
  'list.emptyTitle': 'A lista está vazia',
  'list.emptyText': 'Escolhe no separador «Produtos» o que precisas.',
  'list.counter': ({ open, done }) => `${open} por comprar · ${done} no carrinho`,
  'list.counterLabel': ({ open, done }) => `${open} por comprar, ${done} no carrinho`,
  'list.inCart': 'No carrinho',
  'list.finishButton': 'Terminar compras ({n})',

  'finish.title': 'Terminar compras?',
  'finish.message': ({ done, open }) =>
    `${done} ${plural(done, 'artigo marcado será retirado', 'artigos marcados serão retirados')} da lista.` +
    (open ? ` ${open} ${plural(open, 'artigo não comprado fica', 'artigos não comprados ficam')} na lista.` : ''),
  'finish.confirm': 'Terminar',
  'finish.toast': 'Compras terminadas',

  'product.new': 'Novo produto',
  'product.edit': 'Editar produto',
  'product.add': 'Adicionar',
  'product.save': 'Guardar',
  'product.namePlaceholder': 'p. ex. Bebida de aveia',
  'product.category': 'Categoria',
  'product.newCategory': 'Nova',
  'product.newCategoryOption': 'Nova categoria …',
  'product.newCategoryPlaceholder': 'Nome da categoria',
  'product.addToListNow': 'Adicionar já à lista de compras',
  'product.removeFromList': 'Retirar da lista',
  'product.addToList': 'Adicionar à lista',
  'product.delete': 'Eliminar produto',
  'product.deleteTitle': 'Eliminar «{name}»?',
  'product.deleteText': 'O produto será eliminado da base de dados e da lista para ambos.',
  'product.deleteConfirm': 'Eliminar',
  'product.errNameMissing': 'Introduz um nome.',
  'product.errNameLong': 'O nome é demasiado longo (máx. 80 caracteres).',
  'product.errCategoryMissing': 'Escolhe uma categoria.',
  'product.errCategoryLong': 'A categoria é demasiado longa (máx. 40 caracteres).',
  'product.errExists': '«{name}» já existe.',

  'settings.title': 'Definições',
  'settings.household': 'Casa',
  'settings.members': 'Membros: {n} de 2',
  'settings.inviteHint': 'Código de convite para o teu parceiro:',
  'settings.share': 'Partilhar código',
  'settings.shareText': 'Junta-te à minha casa na lista de compras. Código: {code}',
  'settings.codeCopied': 'Código copiado',
  'settings.nameSaved': 'Nome guardado',
  'settings.loggedInAs': 'Sessão iniciada como {email}',
  'settings.language': 'Idioma',
  'settings.languageHint': 'Aplica-se apenas à tua conta, não à casa inteira.',
  'settings.languageLocalOnly': 'Idioma guardado, por agora, só neste dispositivo (sem ligação).',

  'logout.pendingTitle': 'Ainda não sincronizado',
  'logout.pendingText': ({ n }) =>
    `${n} ${plural(n, 'alteração ainda não chegou', 'alterações ainda não chegaram')} ao servidor. ` +
    `${plural(n, 'Fica guardada', 'Ficam guardadas')} neste dispositivo e ${plural(n, 'será enviada', 'serão enviadas')} depois do próximo início de sessão.`,
  'logout.pendingConfirm': 'Terminar sessão mesmo assim',

  'err.network': 'Erro de rede',
  'err.noConnection': 'Sem ligação ao servidor.',
  'err.noPermission': 'Sem permissão para esta ação.',
  'err.invalidInput': 'Entrada inválida (demasiado longa ou vazia).',
  'err.dbNotSetUp':
    'A base de dados não está configurada. Executa o ficheiro supabase/migrations/20261121000000_init.sql no SQL Editor do Supabase (SETUP.md, passo 3).',
  'err.load': 'Falha ao carregar',
  'err.saveProduct': 'Não foi possível guardar o produto',
  'err.updateProduct': 'Não foi possível alterar o produto',
  'err.deleteProduct': 'Não foi possível eliminar o produto',
  'err.addToList': 'Não foi possível adicionar à lista',
  'err.removeFromList': 'Não foi possível retirar da lista',
  'err.check': 'Não foi possível marcar o artigo',
  'err.finish': 'Não foi possível terminar as compras',
  'err.move': 'Não foi possível guardar a ordem',
  'err.favorite': 'Não foi possível guardar o favorito',
  'err.unknownOp': 'Operação desconhecida {type}',
  'err.storageCorrupt': 'O armazenamento local estava danificado e foi reposto.',
  'err.storageWrite': 'Não foi possível guardar as alterações localmente.',
  'err.rejected': 'O servidor rejeitou a alteração.',
};

export const DICT = { de, en, pt };

/** Anzeigenamen der vorgegebenen Kategorien (Schlüssel = gespeicherter deutscher Name). */
export const CATEGORY_NAMES = {
  en: {
    'Obst & Gemüse': 'Fruit & Vegetables',
    'Brot & Backwaren': 'Bread & Bakery',
    'Milchprodukte & Eier': 'Dairy & Eggs',
    'Fleisch & Fisch': 'Meat & Fish',
    Tiefkühl: 'Frozen',
    'Vorrat & Konserven': 'Pantry & Canned',
    Getränke: 'Drinks',
    'Süßes & Snacks': 'Sweets & Snacks',
    'Drogerie & Haushalt': 'Toiletries & Household',
    Sonstiges: 'Other',
  },
  pt: {
    'Obst & Gemüse': 'Fruta e legumes',
    'Brot & Backwaren': 'Pão e pastelaria',
    'Milchprodukte & Eier': 'Laticínios e ovos',
    'Fleisch & Fisch': 'Carne e peixe',
    Tiefkühl: 'Congelados',
    'Vorrat & Konserven': 'Mercearia e conservas',
    Getränke: 'Bebidas',
    'Süßes & Snacks': 'Doces e snacks',
    'Drogerie & Haushalt': 'Higiene e limpeza',
    Sonstiges: 'Outros',
  },
};

// Bis setLang() aufgerufen wird, Deutsch – so laufen auch Tests ohne Browser deterministisch.
let current = 'de';

export function isSupported(code) {
  return LANGUAGES.some((l) => l.code === code);
}

/**
 * Startsprache: gespeicherte Wahl, sonst die Sprache des Geräts (erste
 * unterstützte aus der Liste), sonst Englisch.
 */
export function initialLang({ stored, deviceLangs = [] } = {}) {
  if (isSupported(stored)) return stored;
  for (const l of deviceLangs) {
    const code = String(l || '').slice(0, 2).toLowerCase();
    if (isSupported(code)) return code;
  }
  return 'en';
}

export function getLang() {
  return current;
}

export function setLang(code) {
  current = isSupported(code) ? code : 'de';
  if (globalThis.document) document.documentElement.lang = current;
  return current;
}

/** Text zu `key` in der aktuellen Sprache; `{name}` wird aus `params` ersetzt. */
export function t(key, params = {}) {
  const v = DICT[current][key] ?? DICT.de[key];
  if (v === undefined) return key;
  if (typeof v === 'function') return v(params);
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Anzeigename einer Kategorie; eigene Kategorien bleiben, wie eingetragen. */
export function categoryLabel(category) {
  return CATEGORY_NAMES[current]?.[category] ?? category;
}
