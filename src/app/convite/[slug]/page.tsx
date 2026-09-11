import { InvitationPortal } from '@/components/invitation-portal';
export default async function InvitationPage({params}:{params:Promise<{slug:string}>}){
  const {slug}=await params;
  return <InvitationPortal slug={slug} />;
}

