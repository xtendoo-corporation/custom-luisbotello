// Stubs mínimos de las APIs de Odoo/OWL usadas por los módulos del POS de Redsys.
// Réplica simplificada del core 19 (payment_interface.js, pos_payment.js, patch.js).
// SOLO para tests QA: no es código de producción.

export const reactive = (o) => o;
export const onMounted = () => {};
export const useState = (o) => o;
export class Component {}
export const useService = () => ({});

export const registered = {services: {}, payment: {}};
export const registry = {
  category(name) {
    return {
      add(key, value) {
        (registered[name] ||= {})[key] = value;
      },
    };
  },
};

export class AlertDialog {}
export class ConfirmationDialog {}
export async function loadJS() {
  throw new Error("loadJS no disponible en tests");
}

export class PaymentInterface {
  constructor(pos, payment_method_id) {
    this.setup(pos, payment_method_id);
  }
  setup(pos, payment_method_id) {
    this.env = pos.env;
    this.pos = pos;
    this.payment_method_id = payment_method_id;
    this.supports_reversals = false;
  }
  get fastPayments() {
    return true;
  }
  sendPaymentRequest() {}
  sendPaymentCancel() {}
  sendPaymentReversal() {}
  close() {}
}
export function register_payment_method(name, cls) {
  registered.payment[name] = cls;
}

// Réplica de PosPayment (point_of_sale/static/src/app/models/pos_payment.js)
export class PosPayment {
  constructor(vals = {}) {
    Object.assign(this, vals);
    this.setup(vals);
  }
  setup(vals) {
    this.payment_date ||= new Date();
    this.amount = vals.amount || 0;
    this.ticket = vals.ticket || "";
  }
  setAmount(v) {
    this.amount = parseFloat(v) || 0;
  }
  getAmount() {
    return this.amount || 0;
  }
  getPaymentStatus() {
    return this.payment_status;
  }
  setPaymentStatus(v) {
    this.payment_status = v;
  }
  setReceiptInfo(v) {
    this.ticket += v;
  }
  async pay() {
    this.setPaymentStatus("waiting");
    return this.handlePaymentResponse(
      await this.payment_method_id.payment_terminal.sendPaymentRequest(this.uuid)
    );
  }
  handlePaymentResponse(ok) {
    this.setPaymentStatus(ok ? "done" : "retry");
    return ok;
  }
  updateRefundPaymentLine() {}
}

// Réplica de @web/core/utils/patch (algoritmo del core: `super` vía skeleton).
const descriptions = new WeakMap();
export function patch(obj, extension) {
  if (!descriptions.has(obj)) {
    descriptions.set(obj, {skeleton: Object.create(Object.getPrototypeOf(obj))});
  }
  const d = descriptions.get(obj);
  for (const [key, prop] of Object.entries(
    Object.getOwnPropertyDescriptors(extension)
  )) {
    const old = Object.getOwnPropertyDescriptor(obj, key);
    if (old) {
      Object.defineProperty(d.skeleton, key, old);
    }
    prop.enumerable = false;
    Object.defineProperty(obj, key, prop);
  }
  d.skeleton = Object.setPrototypeOf(extension, d.skeleton);
}

// Réplica mínima de PaymentScreen: solo lo que ejercitan los tests de overrides/payment_screen.js.
export class PaymentScreen {
  setup() {}
  deletePaymentLine(uuid) {
    // Core 19: borra directo salvo en waiting/waitingCard/timeout (que pasa por sendPaymentCancel)
    this.removed = [...(this.removed || []), uuid];
  }
}

// Réplica mínima de PosStore (point_of_sale/static/src/app/services/pos_store.js): solo los ganchos de borrado.
export class PosStore {
  async beforeDeleteOrder() {
    return true; // En el core abre un diálogo "¿seguro?"
  }
  async _onBeforeDeleteOrder() {
    return true;
  }
  removeOrder(order) {
    this.removedOrders = [...(this.removedOrders || []), order];
  }
  addPendingOrder(ids) {
    this.pending = [...(this.pending || []), ...ids];
  }
  async syncAllOrders(options) {
    this.synced = [...(this.synced || []), options];
    return true;
  }
}

// Réplica mínima de OrderPaymentValidation: `validateOrder` llama a isOrderValid y DESPUÉS elimina las líneas
// no done (order_payment_validation.js:103-135 del core 19).
export default class OrderPaymentValidation {
  constructor({pos, order}) {
    this.pos = pos;
    this._order = order;
  }
  get order() {
    return this._order;
  }
  get paymentLines() {
    return this._order.payment_ids;
  }
  async isOrderValid() {
    return true;
  }
  async validateOrder(isForceValidate) {
    if (await this.isOrderValid(isForceValidate)) {
      this._order.payment_ids = this._order.payment_ids.filter(
        (l) => l.payment_status === "done"
      );
      return true;
    }
    return false;
  }
}
