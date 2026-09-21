import { redirect } from 'next/navigation';
import { AdminError } from '@/lib/admin/auth';
import { getAdminDashboard } from '@/services/admin-dashboard';
import type { Dashboard } from '@/lib/admin/types';
import { LogoutButton } from './session-controls';
import styles from './admin.module.css';

export const dynamic = 'force-dynamic';
const money = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const percent = (value: number) => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value)}%`;
const date = (value: string) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const categories: Record<string, string> = { house: 'Casa', party: 'Festa', travel: 'Viagem', insanos: 'Insanos' };
const statuses: Record<string, string> = { pending: 'Pendente', confirmed: 'Confirmada', expired: 'Expirada', cancelled: 'Cancelada', failed: 'Falhou' };
function Stats({ items }: { items: [string, string | number][] }) {
  return <div className={styles.grid}>{items.map(([label, value]) => <dl className={styles.stat} key={label}><dt>{label}</dt><dd>{value}</dd></dl>)}</div>;
}
export default async function AdminPage() {
  let data: Dashboard;
  try { data = await getAdminDashboard(); }
  catch (error) {
    if (error instanceof AdminError && error.status === 401) redirect('/admin/login?session=expired');
    const denied = error instanceof AdminError && error.status === 403;
    return <main><h1>{denied ? 'Acesso não autorizado' : 'Painel indisponível'}</h1>
      <p className={styles.error} role="alert">{denied ? 'Esta conta não possui autorização administrativa ativa. Solicite a revisão do seu acesso.' : 'Não foi possível consultar os dados agora. Tente novamente em instantes.'}</p>
      <div className={styles.toolbar}><a href="/admin">Tentar novamente</a><LogoutButton /></div></main>;
  }
  const { guests, groups, gifts, contributions: c, goal_totals: goals } = data;
  return <main>
    <div className={styles.toolbar}><div><p>Somente leitura</p><h1>Visão geral</h1></div><LogoutButton /></div>
    <p>Consultado em {date(data.generated_at)} · Horário de São Paulo. <a href="/admin">Atualizar dados</a></p>
    <section className={styles.section} aria-labelledby="guests"><h2 id="guests">Convidados e convites</h2>
      <p>Convidados ativos em grupos ativos. Convites de demonstração não entram nestes números.</p>
      <Stats items={[[ 'Convidados',guests.total],['Adultos',guests.adults],['Crianças',guests.children],['Confirmados',guests.confirmed],['Recusados',guests.declined],['Pendentes',guests.pending]]} />
      <Stats items={[[ 'Grupos / convites',groups.total],['Grupos que responderam',groups.responded],['Grupos sem resposta',groups.unanswered]]} />
      {groups.total === 0 && <p className={styles.note}>Nenhum convite ativo disponível.</p>}
    </section>
    <section className={styles.section} aria-labelledby="gifts"><h2 id="gifts">Presentes ativos</h2>
      <Stats items={[[ 'Presentes ativos',gifts.total],...Object.entries(categories).map(([key,label]): [string,number] => [label,gifts[key as keyof typeof gifts]])]} />
      <p className={styles.note}>{gifts.goal} metas coletivas · {gifts.open} de valor livre · {gifts.fixed} de valor fixo.</p>
      <Stats items={[[ 'Metas coletivas ativas',money(goals.target)],['Confirmado nas metas ativas',money(goals.raised)],['Progresso das metas ativas',percent(goals.percentage)]]} />
      <progress className={styles.progress} value={goals.percentage} max={100} aria-label="Progresso das metas coletivas ativas" />
      <p className={styles.note}>Somente presentes ativos do tipo meta. Boletos e valores fixos não compõem a meta ou seu progresso.</p>
    </section>
    <section className={styles.section} aria-labelledby="contributions"><h2 id="contributions">Contribuições</h2>
      <p>Histórico completo, incluindo presentes inativos. Apenas contribuições confirmadas entram nos valores.</p>
      <Stats items={Object.entries(statuses).map(([key,label]): [string,number] => [label,c[key as keyof typeof c]])} />
      <Stats items={[[ 'Confirmado total',money(c.total)],['Em metas coletivas',money(c.goal)],['Valor livre / boletos',money(c.open)],['Valor fixo',money(c.fixed)],['Presentes Insanos',money(c.insanos)]]} />
      <p className={styles.note}>Insanos é um recorte do total de valor fixo; não some os dois. Status exibidos conforme o banco, sem expirar ou alterar contribuições nesta tela.</p>
    </section>
    <section className={styles.section} aria-labelledby="goals"><h2 id="goals">Metas dos presentes</h2>
      {data.goals.length === 0 ? <p>Nenhuma meta coletiva ativa.</p> : <div className={styles.tableWrap}><table className={styles.table}>
        <caption>Presentes ativos de modalidade coletiva</caption><thead><tr>{['Presente','Categoria','Meta','Confirmado','Progresso','Restante'].map(x=><th key={x} scope="col">{x}</th>)}</tr></thead>
        <tbody>{data.goals.map(g=><tr key={g.id}><th scope="row">{g.name}</th><td>{categories[g.category]}</td><td className={styles.money}>{money(g.target_amount)}</td><td className={styles.money}>{money(g.raised)}</td><td>{percent(g.percentage)}</td><td className={styles.money}>{money(g.remaining)}</td></tr>)}</tbody>
      </table></div>}
    </section>
    <section className={styles.section} aria-labelledby="recent"><h2 id="recent">Contribuições recentes</h2>
      {data.recent.length === 0 ? <p>Nenhuma contribuição registrada.</p> : <div className={styles.tableWrap}><table className={styles.table}>
        <caption>Últimas 20 contribuições · Horário de São Paulo</caption><thead><tr>{['Contribuinte','Presente','Valor','Status','Data / hora'].map(x=><th key={x} scope="col">{x}</th>)}</tr></thead>
        <tbody>{data.recent.map(r=><tr key={r.id}><th scope="row">{r.contributor_name}</th><td>{r.gift_name}</td><td className={styles.money}>{money(r.amount)}</td><td><span className={styles.status}>{statuses[r.payment_status]}</span></td><td className={styles.money}>{date(r.created_at)}</td></tr>)}</tbody>
      </table></div>}
    </section>
  </main>;
}
