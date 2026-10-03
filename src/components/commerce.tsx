import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Banknote, CreditCard, MessageCircle, Package, Send, Wallet, X } from 'lucide-react';
import type { ConversationView, OrderRow, PaymentProvider, PaymentTx, WalletTx } from '@/hooks/use-commerce';
import { useThread } from '@/hooks/use-commerce';

const money = (n: number) => `${Number(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} TND`;
const when = (d: string) =>
  new Date(d).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const shortRef = (id: string) => `#${id.slice(0, 8).toUpperCase()}`;

export const ORDER_STATUS: Record<string, string> = {
  pending: 'En attente',
  confirmed: 'Confirmée',
  processing: 'En préparation',
  shipped: 'Expédiée',
  delivered: 'Livrée',
  cancelled: 'Annulée',
  refunded: 'Remboursée',
};
export const PAYMENT_STATUS: Record<string, string> = {
  unpaid: 'Non payée',
  awaiting_payment: 'Paiement en attente',
  cod_pending: 'À payer à la livraison',
  paid: 'Payée',
  failed: 'Paiement échoué',
  refund_pending: 'Remboursement en cours',
  refunded: 'Remboursée',
};
const TX_STATUS: Record<string, string> = {
  pending: 'En attente',
  succeeded: 'Réussi',
  completed: 'Disponible',
  failed: 'Échoué',
  cancelled: 'Annulé',
  refunded: 'Remboursé',
};
const WALLET_TYPE: Record<string, string> = {
  deposit: 'Dépôt',
  purchase: 'Achat',
  sale_proceeds: 'Produit de vente',
  refund: 'Remboursement',
  withdrawal: 'Retrait',
  adjustment: 'Ajustement',
};
const METHOD: Record<string, string> = {
  card: 'Carte bancaire',
  d17: 'D17',
  flouci: 'Flouci Wallet',
  cod: 'Paiement à la livraison',
  wallet: 'SouqTN Wallet',
};

function Avatar({ name, url }: { name: string; url?: string | null | undefined }) {
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full bg-[#e7eee6] text-xs font-bold text-[#205e52]">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : initials}
    </div>
  );
}

/* ------------------------------ Messages ----------------------------- */

export function MessagesView({
  userId,
  conversations,
  loading,
  activeId,
  onSelect,
  onRead,
  notify,
}: {
  userId: string;
  conversations: ConversationView[];
  loading: boolean;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onRead: () => void;
  notify: (m: string) => void;
}) {
  const active = conversations.find((c) => c.id === activeId) ?? null;
  const { messages, send } = useThread(activeId, userId, onRead);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [messages.length]);

  const submit = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await send(text);
      setText('');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Impossible d’envoyer le message.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-[320px_1fr]">
      <div className={`panel divide-y divide-[#eee8dd] self-start ${active ? 'hidden md:block' : ''}`}>
        {loading && !conversations.length && <div className="p-5 text-sm text-[#849189]">Chargement…</div>}
        {!loading && !conversations.length && (
          <div className="p-6 text-sm text-[#849189]" data-testid="status-conversations-empty">
            Aucune conversation. Ouvrez une annonce et cliquez sur « Écrire au vendeur ».
          </div>
        )}
        {conversations.map((c, i) => {
          const name = c.other?.full_name || c.other?.username || 'Membre';
          return (
            <button
              key={c.id}
              className={`flex w-full items-center gap-3 p-4 text-left hover:bg-[#faf8f2] ${c.id === activeId ? 'bg-[#f3f0e8]' : ''}`}
              onClick={() => onSelect(c.id)}
              data-testid={`button-conversation-${i}`}
            >
              <Avatar name={name} url={c.other?.avatar_url} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-bold">{name}</span>
                  <span className="shrink-0 text-[10px] text-[#9aa59e]">{when(c.last_message_at)}</span>
                </div>
                {c.listing_title && <div className="truncate text-[10px] font-semibold text-[#a8765d]">{c.listing_title}</div>}
                <div className="mt-0.5 truncate text-xs text-[#849189]">{c.last_message_preview || 'Nouvelle conversation'}</div>
              </div>
              {c.unread > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#cb795c] px-1.5 text-[10px] font-bold text-white">
                  {c.unread}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {active ? (
        <section className="panel flex min-h-[460px] flex-col" data-testid="panel-thread">
          <header className="flex items-center gap-3 border-b border-[#eee8dd] p-4">
            <button className="icon-btn md:hidden" onClick={() => onSelect(null)} aria-label="Retour">
              <ArrowLeft size={16} />
            </button>
            <Avatar name={active.other?.full_name || active.other?.username || 'Membre'} url={active.other?.avatar_url} />
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{active.other?.full_name || active.other?.username || 'Membre'}</div>
              {active.listing_title && <div className="truncate text-[11px] text-[#849189]">À propos de : {active.listing_title}</div>}
            </div>
          </header>
          <div className="flex-1 space-y-2 overflow-y-auto p-4" style={{ maxHeight: 520 }}>
            {!messages.length && <div className="py-10 text-center text-xs text-[#9aa59e]">Écrivez le premier message.</div>}
            {messages.map((m) => {
              const mine = m.sender_id === userId;
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[78%] rounded-2xl px-4 py-2.5 text-sm ${mine ? 'bg-[#205e52] text-white' : 'bg-[#f1eee6] text-[#30413b]'}`}
                  >
                    <div className="whitespace-pre-wrap break-words">{m.body}</div>
                    <div className={`mt-1 text-[9px] ${mine ? 'text-white/70' : 'text-[#93a098]'}`}>
                      {when(m.created_at)}
                      {mine && (m.read_at ? ' · Lu' : ' · Envoyé')}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          <form
            className="flex gap-2 border-t border-[#eee8dd] p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <textarea
              className="field min-h-[44px] flex-1 resize-none py-2.5"
              rows={1}
              maxLength={2000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Votre message…"
              data-testid="input-message"
            />
            <button className="btn-primary flex items-center gap-2" disabled={sending || !text.trim()} data-testid="button-send-message">
              <Send size={14} />
              Envoyer
            </button>
          </form>
        </section>
      ) : (
        <div className="panel hidden place-items-center p-10 text-center text-sm text-[#849189] md:grid">
          <div>
            <MessageCircle className="mx-auto mb-3 text-[#a8765d]" size={26} />
            Choisissez une conversation.
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------ Checkout ----------------------------- */

export function CheckoutDialog({
  open,
  listing,
  providers,
  walletAvailable,
  defaults,
  onClose,
  onSubmit,
}: {
  open: boolean;
  listing: { id: string; title: string; priceTnd: number } | null;
  providers: PaymentProvider[];
  walletAvailable: number;
  defaults: { name: string; phone: string; city: string };
  onClose: () => void;
  onSubmit: (input: { method: string; name: string; phone: string; address: string; city: string; notes: string; idempotencyKey: string }) => Promise<void>;
}) {
  const [method, setMethod] = useState('cod');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useMemo(() => (open && listing ? crypto.randomUUID() : ''), [open, listing]);
  useEffect(() => {
    if (open) {
      setError('');
      setMethod('cod');
    }
  }, [open]);
  if (!open || !listing) return null;
  const order = ['wallet', 'cod', 'card', 'd17', 'flouci'];
  const list = [...providers].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="mb-5 flex items-start justify-between">
          <div>
            <div className="eyebrow">SouqTN · commande</div>
            <h2 className="display mt-1 text-2xl font-extrabold">Acheter</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            <X size={17} />
          </button>
        </div>
        <div className="mb-4 rounded-xl bg-[#f3f0e8] p-3 text-sm">
          <div className="font-bold">{listing.title}</div>
          <div className="mt-1 font-extrabold text-[#205e52]">{money(listing.priceTnd)}</div>
        </div>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setBusy(true);
            setError('');
            try {
              await onSubmit({
                method,
                name: String(fd.get('name') || ''),
                phone: String(fd.get('phone') || ''),
                address: String(fd.get('address') || ''),
                city: String(fd.get('city') || ''),
                notes: String(fd.get('notes') || ''),
                idempotencyKey: key,
              });
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Impossible de créer la commande.');
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="eyebrow">Moyen de paiement</div>
          <div className="grid gap-2">
            {list.map((p) => {
              const disabled = !p.enabled || (p.code === 'wallet' && walletAvailable < listing.priceTnd);
              return (
                <label
                  key={p.code}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${method === p.code ? 'border-[#39816e] bg-[#eef4ef]' : 'border-[#e6e0d4]'} ${disabled ? 'opacity-55' : 'cursor-pointer'}`}
                >
                  <input type="radio" name="method" value={p.code} checked={method === p.code} disabled={disabled} onChange={() => setMethod(p.code)} data-testid={`radio-pay-${p.code}`} />
                  {p.code === 'cod' ? <Banknote size={16} /> : p.code === 'wallet' ? <Wallet size={16} /> : <CreditCard size={16} />}
                  <span className="flex-1 font-semibold">{p.label}</span>
                  <span className="text-[10px] text-[#849189]">
                    {!p.enabled ? 'Bientôt disponible' : p.code === 'wallet' ? `Solde : ${money(walletAvailable)}` : ''}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="eyebrow pt-2">Livraison</div>
          <input className="field" name="name" required minLength={2} maxLength={120} defaultValue={defaults.name} placeholder="Nom complet" />
          <div className="grid grid-cols-2 gap-3">
            <input className="field" name="phone" required minLength={6} maxLength={30} defaultValue={defaults.phone} placeholder="Téléphone" />
            <input className="field" name="city" required minLength={2} maxLength={80} defaultValue={defaults.city} placeholder="Ville" />
          </div>
          <input className="field" name="address" required minLength={4} maxLength={300} placeholder="Adresse de livraison" />
          <textarea className="field min-h-[70px] py-3" name="notes" maxLength={500} placeholder="Note pour le vendeur (facultatif)" />
          {error && <div className="rounded-xl bg-[#f7eee3] p-3 text-xs text-[#8c583f]" role="alert">{error}</div>}
          <button className="btn-primary w-full" disabled={busy} data-testid="button-confirm-order">
            {busy ? 'Création…' : method === 'cod' ? 'Commander · payer à la livraison' : `Payer ${money(listing.priceTnd)}`}
          </button>
          <p className="text-center text-[10px] text-[#9a8e7d]">SouqTN n’enregistre jamais vos données de carte ni vos identifiants de paiement.</p>
        </form>
      </section>
    </div>
  );
}

/* ---------------------------- Account tabs --------------------------- */

export function OrdersSection({
  userId,
  orders,
  onStatus,
  onConfirmCod,
}: {
  userId: string;
  orders: OrderRow[];
  onStatus: (id: string, s: string) => void;
  onConfirmCod: (id: string) => void;
}) {
  if (!orders.length) return <div className="panel p-7 text-sm text-[#849189]">Vos achats et ventes apparaîtront ici.</div>;
  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const seller = o.seller_id === userId;
        const item = o.order_items[0];
        const actions: [string, string][] = [];
        if (seller) {
          if (o.status === 'pending' && ['paid', 'cod_pending'].includes(o.payment_status)) actions.push(['confirmed', 'Confirmer']);
          if (o.status === 'confirmed') actions.push(['processing', 'En préparation']);
          if (o.status === 'processing') actions.push(['shipped', 'Marquer expédiée']);
          if (['pending', 'confirmed', 'processing'].includes(o.status)) actions.push(['cancelled', 'Annuler']);
        } else {
          if (o.status === 'shipped') actions.push(['delivered', 'Confirmer la réception']);
          if (o.status === 'pending') actions.push(['cancelled', 'Annuler']);
        }
        return (
          <article key={o.id} className="panel p-4" data-testid={`card-order-${o.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf0e7] text-[#478071]"><Package size={17} /></div>
                <div>
                  <div className="text-sm font-bold">{item?.title || 'Commande'}</div>
                  <div className="mt-0.5 text-[11px] text-[#849189]">
                    {shortRef(o.id)} · {seller ? 'Vente' : 'Achat'} · {METHOD[o.payment_method] || o.payment_method} · {when(o.created_at)}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-extrabold text-[#205e52]">{money(o.total_amount)}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#a8765d]">
                  {ORDER_STATUS[o.status]} · {PAYMENT_STATUS[o.payment_status]}
                </div>
              </div>
            </div>
            {seller && (
              <div className="mt-3 rounded-xl bg-[#f6f3ec] p-3 text-xs text-[#5f7068]">
                Livraison : {o.shipping_name} · {o.shipping_phone} · {o.shipping_address}, {o.shipping_city}
                {o.notes && <div className="mt-1 italic">« {o.notes} »</div>}
              </div>
            )}
            {(actions.length > 0 || (seller && o.payment_method === 'cod' && o.payment_status === 'cod_pending' && ['shipped', 'delivered'].includes(o.status))) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {actions.map(([s, label]) => (
                  <button key={s} className={s === 'cancelled' ? 'btn-quiet !text-[#9b4438]' : 'btn-quiet'} onClick={() => onStatus(o.id, s)} data-testid={`button-order-${s}`}>
                    {label}
                  </button>
                ))}
                {seller && o.payment_method === 'cod' && o.payment_status === 'cod_pending' && ['shipped', 'delivered'].includes(o.status) && (
                  <button className="btn-primary" onClick={() => onConfirmCod(o.id)} data-testid="button-confirm-cod">Paiement reçu</button>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

export function WalletSection({
  available,
  pending,
  ledger,
  onWithdraw,
}: {
  available: number;
  pending: number;
  ledger: WalletTx[];
  onWithdraw: (amount: number) => Promise<void>;
}) {
  const [filter, setFilter] = useState('all');
  const [amount, setAmount] = useState('');
  const rows = filter === 'all' ? ledger : ledger.filter((t) => t.type === filter);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="panel p-5">
          <div className="eyebrow">Solde disponible</div>
          <div className="display mt-2 text-3xl font-extrabold text-[#205e52]" data-testid="text-wallet-available">{money(available)}</div>
        </div>
        <div className="panel p-5">
          <div className="eyebrow">En attente</div>
          <div className="display mt-2 text-3xl font-extrabold">{money(pending)}</div>
          <div className="mt-1 text-[10px] text-[#849189]">Ventes disponibles après confirmation de la livraison.</div>
        </div>
      </div>
      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <form
          className="flex flex-1 flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await onWithdraw(Number(amount));
            setAmount('');
          }}
        >
          <input className="field max-w-[180px]" type="number" min="1" step="0.001" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Montant (TND)" />
          <button className="btn-quiet" disabled={!amount || Number(amount) > available} data-testid="button-withdraw">Demander un retrait</button>
        </form>
        <div className="text-[10px] text-[#849189]">Les dépôts seront disponibles dès l’activation d’un prestataire de paiement officiel.</div>
      </div>
      <div className="flex flex-wrap gap-2">
        {[['all', 'Tout'], ['deposit', 'Dépôts'], ['purchase', 'Achats'], ['sale_proceeds', 'Ventes'], ['refund', 'Remboursements'], ['withdrawal', 'Retraits']].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'active' : ''}`} onClick={() => setFilter(k ?? "all")}>{l}</button>
        ))}
      </div>
      {rows.length ? (
        <div className="panel divide-y divide-[#eee8dd]">
          {rows.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 p-4 text-sm">
              <div>
                <div className="font-bold">{WALLET_TYPE[t.type]}</div>
                <div className="text-[11px] text-[#849189]">{t.description || t.reference} · {when(t.created_at)}</div>
              </div>
              <div className="text-right">
                <div className={`font-extrabold ${Number(t.amount) < 0 ? 'text-[#9b4438]' : 'text-[#205e52]'}`}>
                  {Number(t.amount) > 0 ? '+' : ''}{money(t.amount)}
                </div>
                <div className="text-[10px] text-[#849189]">{TX_STATUS[t.status]}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="panel p-7 text-sm text-[#849189]">Aucun mouvement pour le moment.</div>
      )}
    </div>
  );
}

export function PaymentsSection({ payments }: { payments: PaymentTx[] }) {
  if (!payments.length) return <div className="panel p-7 text-sm text-[#849189]">Aucun paiement pour le moment.</div>;
  return (
    <div className="panel divide-y divide-[#eee8dd]">
      {payments.map((p) => (
        <div key={p.id} className="flex items-center justify-between gap-3 p-4 text-sm">
          <div>
            <div className="font-bold">{METHOD[p.provider] || p.provider}</div>
            <div className="text-[11px] text-[#849189]">Commande {shortRef(p.order_id)} · {when(p.created_at)}</div>
          </div>
          <div className="text-right">
            <div className="font-extrabold">{money(p.amount)}</div>
            <div className="text-[10px] text-[#849189]">{TX_STATUS[p.status]}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
