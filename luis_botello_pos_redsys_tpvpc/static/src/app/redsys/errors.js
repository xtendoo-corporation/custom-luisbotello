/** @odoo-module */
// Mensajes en español para los códigos de retorno de la librería TPV-PC
// Implantado (§4.9 del plan) y el catálogo de errores TPVPC (Anexo VI,
// Integración TpvpcImplantado v2.52). Lógica pura, sin dependencias de Odoo.

/** Códigos propios del servicio (no vienen de Redsys). */
export const CODE_BUSY = "BUSY";
export const CODE_UNKNOWN_RESULT = "UNKNOWN_RESULT";
export const CODE_NOT_CHARGED = "NOT_CHARGED";
export const CODE_NOT_INITIALIZED = "NOT_INITIALIZED";
export const CODE_INVALID_PARAMS = "INVALID_PARAMS";
export const CODE_LIB_EXPIRED = "LIB_EXPIRED";
export const CODE_TRANSPORT = "TRANSPORT";
export const CODE_BAD_RESPONSE = "BAD_RESPONSE";

/** Retorno numérico de transporte: fallo de comunicación local (no es de Redsys). */
export const RET_TRANSPORT_ERROR = -98;
/** Retorno del servicio HTTP: hay que reinicializar con fnDllIniTpvpcLatente. */
export const RET_SERVICE_REINIT = -99;
/** Librería caducada (cualquier función). */
export const RET_LIB_EXPIRED = -40;

const T_INIT = "fnDllIniTpvpcLatente";
const T_PAY = "fnDllOperPinPad";
const T_REFUND = "fnDllOperComContable";
const T_QUERY = "fnDllOperConsulta";

const NOT_INIT =
  "El datáfono no está inicializado. Se reiniciará la conexión; si persiste, reinicie el POS.";

/** Códigos de retorno por función (§4.9 + manual v2.52, Anexo de retornos). */
export const RETURN_CODES = {
  [T_INIT]: {
    [-1]: "Error interno al iniciar la librería del datáfono. Reinicie la librería.",
    [-3]: "Falta el código de comercio en la configuración del método de pago.",
    [-4]: "Falta el número de terminal en la configuración del método de pago.",
    [-5]: "Falta la clave de firma en la configuración del método de pago.",
    [-13]:
      "Tiempo agotado buscando el datáfono. Compruebe que está encendido y conectado.",
    [-14]: "No se pudo arrancar la interfaz del datáfono. Reinicie el servicio TPV-PC.",
    [-16]:
      "Sin conexión con el servicio web de Redsys. Compruebe la conexión a Internet.",
    [-18]:
      "Datos incorrectos (comercio, terminal o clave). Revise la configuración del método de pago.",
    [-19]: "El datáfono está mal configurado. Llame al banco.",
    [-20]: "Puerto COM incorrecto. Revise el puerto configurado para el datáfono.",
    [-21]: "La versión de protocolo configurada no es compatible con el datáfono.",
  },
  [T_PAY]: {
    [-1]: NOT_INIT,
    [-2]: "Sin respuesta del datáfono o de Redsys (tiempo agotado). Se comprobará si el cobro llegó a realizarse.",
    [-3]: "Error de sistema en el servicio del datáfono. Reinicie la aplicación.",
    [-4]: "Formato de datos incorrecto en la operación.",
    [-13]: "Parámetro inválido en la operación de cobro.",
    [-17]: "El buffer de respuesta es insuficiente (error interno de integración).",
    [-18]: "Formato de parámetro incorrecto (por ejemplo, el importe).",
  },
  [T_REFUND]: {
    [-1]: NOT_INIT,
    [-2]: "Error interno al realizar la devolución. Se comprobará si llegó a realizarse.",
    [-3]: "Parámetros incorrectos en la devolución.",
    [-12]: "Error interno del sistema al realizar la devolución.",
  },
  [T_QUERY]: {
    [-1]: NOT_INIT,
    [-2]: "Error interno al consultar las operaciones. Revise la conexión a Internet.",
    [-3]: "Parámetros de consulta incorrectos.",
    [-12]: "Error interno del sistema al consultar operaciones.",
    [-15]: "Operación de consulta no soportada.",
  },
};

const GENERIC_RETURN = {
  [-99]: "El servicio del datáfono perdió la sesión; hay que reinicializarlo.",
  [RET_TRANSPORT_ERROR]:
    "No hay comunicación con el servicio del datáfono. Compruebe que TpvpcPinPadImplantadoService está en ejecución.",
  [RET_LIB_EXPIRED]:
    "La librería TPV-PC ha caducado. Es necesario actualizar el servicio del datáfono.",
};

/** Mensaje en español para el retorno numérico de una función. Nunca lanza. */
export function describeReturn(fn, code) {
  const specific = RETURN_CODES[fn] && RETURN_CODES[fn][code];
  if (
    code === RET_LIB_EXPIRED ||
    code === RET_TRANSPORT_ERROR ||
    code === RET_SERVICE_REINIT
  ) {
    return GENERIC_RETURN[code];
  }
  return specific || `Error desconocido del datáfono (código ${code}).`;
}

const M_INTERNAL =
  "Se ha producido un error al realizar la operación. Inténtelo de nuevo.";
const M_READ =
  "La tarjeta no se ha leído correctamente. Asegúrese de que la tarjeta está en buen estado e inténtelo de nuevo.";
const M_BUSY = "El sistema está ocupado. Reinténtelo en unos instantes.";
const M_MISSING = "Faltan datos para llevar a cabo la operación solicitada.";

/**
 * Catálogo Anexo VI. Las claves están normalizadas (ver normalizeTpvpcCode):
 * mayúsculas y sin guiones ni subrayados, p. ej. "TPVPC0074".
 * Solo se incluyen los códigos con sentido en el cobro/consulta/devolución;
 * los de gestión de usuarios caen en el mensaje genérico.
 */
export const TPVPC_ERRORS = {
  SOAPTPVPC0000: "Error al validar el mensaje enviado a Redsys.",
  SOAPTPVPC0001: "Error genérico de Redsys.",
  SOAPTPVPC0002: "Firma incorrecta. Revise la clave de firma del método de pago.",
  SOAPTPVPC0003: "La versión del mensaje no está soportada.",
  SOAPTPVPC0004: "El mensaje no contiene los elementos requeridos.",
  SOAPTPVPC0005: "Algunos elementos del mensaje no contienen los valores esperados.",
  SOAPTPVPC0006: "El mensaje ha caducado. Compruebe la hora del equipo.",
  SOAPTPVPC0007: "Error desconocido de Redsys.",
  SOAPTPVPC0008: "La versión del mensaje no soporta la operativa especificada.",
  SOAPTPVPC0009: "La consulta no puede incluir banda y número de tarjeta a la vez.",
  SOAPTPVPC0010: "El método al que se envía la petición no es el adecuado.",
  SOAPTPVPC0014: "No existe una operación con esos datos.",
  SOAPTPVPC0015: "Clave no localizada. Revise la clave de firma.",
  TPVPC0009: "El importe de la devolución supera el importe de la operación original.",
  TPVPC0014:
    "Error en el sistema de Redsys. Inténtelo más tarde o contacte con el administrador.",
  TPVPC0015: M_MISSING,
  TPVPC0016: "El comercio no posee ningún terminal TPV-PC válido.",
  TPVPC0018:
    "La tarjeta no se ha leído correctamente. Compruebe la asociación lector/terminal e inténtelo de nuevo.",
  TPVPC0019:
    "La tarjeta no se ha leído correctamente. Compruebe la asociación lector/terminal e inténtelo de nuevo.",
  TPVPC0020: M_INTERNAL,
  TPVPC0025: "El formato del número de tarjeta no es válido.",
  TPVPC0026: M_READ,
  TPVPC0027: "El formato de la fecha de caducidad no es válido.",
  TPVPC0030: M_BUSY,
  TPVPC0031: M_INTERNAL,
  TPVPC0032:
    "El sistema no puede acceder a las operaciones requeridas en este momento.",
  TPVPC0034:
    "El usuario de acceso ha sido bloqueado. Contacte con el administrador para desbloquearlo.",
  TPVPC0035: "El usuario de acceso está dado de baja. Contacte con el administrador.",
  TPVPC0036: M_MISSING,
  TPVPC0037: "El sistema no puede acceder al usuario especificado en este momento.",
  TPVPC0040: "El sistema no ha podido completar la operación. Inténtelo de nuevo.",
  TPVPC0048: "El medio de pago no es válido o no está soportado por el comercio.",
  TPVPC0051: "No se han definido criterios suficientes para realizar la operación.",
  TPVPC0052: "La contraseña no es correcta.",
  TPVPC0053: "El usuario especificado no existe.",
  TPVPC0055: "El comercio no tiene habilitada la entrada manual de datos.",
  TPVPC0057: "El código de entidad especificado no existe.",
  TPVPC0058: "La moneda especificada no coincide con la moneda del terminal.",
  TPVPC0059:
    "El sistema no puede acceder al terminal especificado. Compruebe que existe.",
  TPVPC0060: "No existe ningún terminal apropiado para la marca de tarjeta utilizada.",
  TPVPC0061: "El sistema no ha podido completar la operación. Inténtelo de nuevo.",
  TPVPC0063: "El sistema no ha podido completar la operación. Inténtelo de nuevo.",
  TPVPC0071: "El comercio no tiene habilitada la operativa de preautorizaciones.",
  TPVPC0072: "No se recibió el dato de autenticación de la tarjeta (CVC2).",
  TPVPC0074: "El CVC2 introducido no coincide con el de la tarjeta.",
  TPVPC0075: "El perfil del usuario no tiene acceso al TPV-PC.",
  TPVPC0077: "Acceso denegado. Compruebe el formato del mensaje, la firma y la fecha.",
  TPVPC0078:
    "No tiene permisos asignados para esta operación. Contacte con el administrador.",
  TPVPC0079: "El comercio/terminal indicado no existe. Revise la configuración.",
  TPVPC0083:
    "La configuración del lector no es correcta. Reintente y consulte con el administrador.",
  TPVPC0084:
    "La tarjeta no se ha leído correctamente. Compruebe la tarjeta y el lector.",
  TPVPC0085: M_READ,
  TPVPC0087: M_BUSY,
  TPVPC0089: M_INTERNAL,
  TPVPC0090:
    "El terminal no tiene asociado ningún lector válido. Configure el terminal.",
  TPVPC0091: "La operación especificada no existe.",
  TPVPC0092: M_INTERNAL,
  TPVPC0093: M_INTERNAL,
  TPVPC0096: "Error en el sistema: el formato de los datos no es correcto.",
  TPVPC0100:
    "No se puede devolver esa operación (devolución no permitida sobre la operación original).",
  TPVPC0101: "La firma no es correcta. Revise la clave de firma.",
  TPVPC0104: "La tarjeta no está asociada a ningún usuario válido en TPV-PC.",
  TPVPC0107: "El comercio no tiene configurada la moneda especificada.",
  TPVPC0108: "Error al realizar la conversión de divisas.",
  TPVPC0109: "La tarjeta no admite el pago en la divisa especificada.",
  TPVPC0115: "La tarjeta no admite aplazamiento de pagos.",
  TPVPC0117:
    "Redsys ya está procesando una operación con los mismos datos. Espere unos instantes.",
  TPVPC0118:
    "Redsys ya registra una operación AUTORIZADA con los mismos datos. No repita el cobro sin comprobarlo.",
  TPVPC0119:
    "Existe una operación anterior con los mismos datos y resultado de ERROR. Espere unos instantes antes de repetir.",
  TPVPC0120:
    "Existe una operación anterior con los mismos datos y resultado RECHAZADA. Espere unos instantes antes de repetir.",
  TPVPC0121: "No se puede realizar la acción requerida sobre la operación.",
  TPVPC0122: "No se pudo llevar a cabo la operación por un error en el importe.",
  TPVPC0123:
    "No se puede realizar la acción sobre una operación que resultó errónea o denegada.",
  TPVPC0124: "No se puede realizar la acción requerida debido a un error.",
  TPVPC0126: "La tarjeta utilizada no es válida.",
  TPVPC0131: "El comercio no tiene activada esta operativa.",
  TPVPC0135: "Error al tratar el mensaje PUP.",
  TPVPC0148: "No es posible realizar el aplazamiento del pago.",
  TPVPCEMV0000: "Error interno en el protocolo TPV-PC EMV.",
  TPVPCEMV0001: "Error interno en el protocolo TPV-PC EMV.",
  TPVPCEMV0002: "Operación cancelada en el datáfono.",
  TPVPCEMV0003: "Error interno en el protocolo TPV-PC EMV.",
  TPVPCEMV0004: "Error en el proceso TLS con Redsys.",
  TPVPCEMV0005: "PIN online solicitado y no introducido.",
  TPVPCEMV0006: "Terminal no operativo: sin claves simétricas. Contacte con el banco.",
  AXTPVPC0001:
    "La configuración especificada no es correcta. Revise la descripción del error.",
  AXTPVPC0002: "Error de comunicación con TPV-PC. Revise la conexión a Internet.",
  AXTPVPC0003:
    "Error de comunicación con el datáfono. Revise la configuración y la conexión física.",
  AXTPVPC0004: "Problema en la configuración del puerto de comunicaciones.",
  AXTPVPC0005:
    "Error en el componente de comunicación con el datáfono. Es necesario reinstalar la aplicación.",
};

/** "TPV-PC0074" / "TPVPC0074" / "tpv-pc_emv0002" -> "TPVPC0074" / "TPVPCEMV0002". */
export function normalizeTpvpcCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[-_\s]/g, "");
}

/** Mensaje del catálogo Anexo VI (o null si no está catalogado). */
export function describeTpvpc(code) {
  return TPVPC_ERRORS[normalizeTpvpcCode(code)] || null;
}

/**
 * Códigos TPVPC que indican que Redsys YA puede tener una operación
 * autorizada con esos datos: ante ellos hay que consultar, no dar por fallido.
 */
export const TPVPC_CHECK_BEFORE_FAIL = new Set(["TPVPC0117", "TPVPC0118"]);

export function needsRecoveryQuery(code) {
  return TPVPC_CHECK_BEFORE_FAIL.has(normalizeTpvpcCode(code));
}

/** Mensajes de los resultados propios del servicio. */
export const SERVICE_MESSAGES = {
  [CODE_BUSY]: "Hay otra operación en curso en el datáfono. Espere a que termine.",
  [CODE_UNKNOWN_RESULT]:
    "No se pudo confirmar si el cobro se realizó. NO repita el cobro: verifique la operación en el TPV-PC de Redsys antes de continuar.",
  [CODE_NOT_CHARGED]: "El cobro no se realizó. Puede reintentarlo.",
  [CODE_NOT_INITIALIZED]: "El datáfono no está inicializado.",
  [CODE_INVALID_PARAMS]: "Datos de la operación no válidos.",
  [CODE_LIB_EXPIRED]: GENERIC_RETURN[RET_LIB_EXPIRED],
  [CODE_TRANSPORT]: GENERIC_RETURN[RET_TRANSPORT_ERROR],
  [CODE_BAD_RESPONSE]: "Respuesta del datáfono no interpretable.",
};
