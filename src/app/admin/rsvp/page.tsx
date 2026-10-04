import { redirect } from 'next/navigation';
import { AdminError } from '@/lib/admin/auth';
import type { AdminRsvpDetails, AdminRsvpGuest } from '@/lib/admin/types';
import { getAdminRsvpDetails } from '@/services/admin-rsvp';
import { LogoutButton } from '../session-controls';
import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

type StatusFilter = 'all' | AdminRsvpGuest['attendance_status'];
const filters: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'confirmed', label: 'Confirmados' },
  { value: 'declined', label: 'Recusados' },
  { value: 'pending', label: 'Pendentes' },
];
const statusLabels: Record<AdminRsvpGuest['attendance_status'], string> = {
  confirmed: 'Confirmado', declined: 'Recusado', pending: 'Pendente',
};
const date = (value: string) => new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(value));
const orDash = (value: string | null) => value?.trim() || '—';

export default async function AdminRsvpPage({ searchParams }: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const requestedStatus = (await searchParams).status;
  const selected: StatusFilter = typeof requestedStatus === 'string' &&
    filters.some(filter => filter.value === requestedStatus) ? requestedStatus as StatusFilter : 'all';
  let data: AdminRsvpDetails;
  try { data = await getAdminRsvpDetails(); }
  catch (error) {
    if (error instanceof AdminError && error.status === 401) redirect('/admin/login?session=expired');
    const denied = error instanceof AdminError && error.status === 403;
    return <main><h1>{denied ? 'Acesso não autorizado' : 'Respostas indisponíveis'}</h1>
      <p className={styles.error} role="alert">{denied ? 'Esta conta não possui autorização administrativa ativa.' : 'Não foi possível consultar os dados agora. Tente novamente em instantes.'}</p>
      <div className={styles.toolbar}><a href="/admin">Voltar ao painel</a><LogoutButton /></div></main>;
  }

  const guests = selected === 'all' ? data.guests : data.guests.filter(guest => guest.attendance_status === selected);
  const groups = [...new Map(guests.map(guest => [guest.group_id, {
    id: guest.group_id, name: guest.group_name, members: guests.filter(member => member.group_id === guest.group_id),
    submittedAt: guest.submitted_at,
    dietary: guest.dietary_restrictions, notes: guest.notes,
  }])).values()];

  return <main>
    <div className={styles.toolbar}><div><p>Somente leitura · <a href="/admin">Voltar ao painel</a></p><h1>Respostas dos convidados</h1></div><LogoutButton /></div>
    <p>Convidados ativos em convites ativos, sem grupos de demonstração. Consultado em {date(data.generated_at)} · Horário de São Paulo.</p>
    <div className={styles.grid}>
      {([['Total', data.summary.total], ['Confirmados', data.summary.confirmed], ['Recusados', data.summary.declined], ['Pendentes', data.summary.pending]] as const)
        .map(([label, value]) => <dl className={styles.stat} key={label}><dt>{label}</dt><dd>{value}</dd></dl>)}
    </div>
    <nav className={styles.rsvpFilters} aria-label="Filtrar convidados por presença">
      {filters.map(filter => <a key={filter.value} href={filter.value === 'all' ? '/admin/rsvp' : `/admin/rsvp?status=${filter.value}`}
        aria-current={selected === filter.value ? 'page' : undefined}>{filter.label}</a>)}
    </nav>
    <p>{guests.length} {guests.length === 1 ? 'convidado encontrado' : 'convidados encontrados'}.</p>
    {guests.length === 0 ? <p className={styles.note}>Nenhum convidado neste filtro.</p> : <>
      <div className={styles.tableWrap} role="region" aria-label="Lista nominal dos convidados" tabIndex={0}>
        <table className={`${styles.table} ${styles.rsvpTable}`}>
          <caption>Presença individual e dados de resposta do convite</caption>
          <thead><tr>{['Convidado', 'Grupo', 'Tipo', 'Status', 'Telefone', 'Respondido em'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{guests.map(guest => <tr key={guest.id}>
            <th scope="row">{guest.name}</th><td>{guest.group_name}</td>
            <td>{guest.type === 'adult' ? 'Adulto' : 'Criança'}</td>
            <td><span className={styles.status}>{statusLabels[guest.attendance_status]}</span></td>
            <td>{guest.type === 'adult' ? orDash(guest.phone) : '—'}</td><td>{guest.submitted_at ? date(guest.submitted_at) : '—'}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <section className={styles.section} aria-labelledby="rsvp-group-details">
        <h2 id="rsvp-group-details">Detalhes dos convites</h2>
        <p>Restrições alimentares e observações pertencem ao convite. Abra um grupo para consultar os detalhes.</p>
        <div className={styles.rsvpDetails}>{groups.map(group => <details key={group.id}>
          <summary>{group.name} · {group.members.map(member => member.name).join(', ')}</summary>
          <dl><dt>Respondido em</dt><dd>{group.submittedAt ? date(group.submittedAt) : '—'}</dd>
            <dt>Restrições alimentares</dt><dd>{orDash(group.dietary)}</dd>
            <dt>Observações</dt><dd>{orDash(group.notes)}</dd></dl>
        </details>)}</div>
      </section>
    </>}
  </main>;
}
