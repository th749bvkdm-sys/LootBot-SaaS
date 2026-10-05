import { getStoreAccess } from './staff-access';
import { parseNavigationCallback } from './telegram-navigation';

/** A design permission never grants access to private customer records. */
export async function canPreviewCustomer(storeId:string,userId:string,customerId:unknown,callback:unknown){
  if(!customerId)return true;
  if(!await getStoreAccess(storeId,userId,'customers.read'))return false;
  const action=parseNavigationCallback(callback);
  const orderData=action?.kind==='orders'||action?.kind==='order'||(action?.kind==='commerce'&&action.feature==='notifications');
  return !orderData||!!await getStoreAccess(storeId,userId,'orders.read');
}
