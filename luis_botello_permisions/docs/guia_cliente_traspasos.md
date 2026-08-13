# Guía rápida: Permisos de traspasos entre almacenes

Hola:

Hemos configurado los permisos de los **traspasos entre almacenes** tal y como nos
pedisteis. Aquí tenéis, en lenguaje sencillo, qué cambia y cómo trabajar.

## Qué hace

- Solo algunas personas pueden **crear traspasos** de mercancía entre almacenes.
- Las personas con el permiso **Recepcionar traspasos entre almacenes** pueden
  validar la recepción de mercancía cuando llega, pero no crear traspasos.

## Quién puede hacer qué

**Pueden crear y validar traspasos entre almacenes:**

- Vanessa
- Julia
- Alicia
- Lupo

**Solo pueden recepcionar (no crear traspasos):**

- Jennifer
- Ismahan
- Iusra
- Yamiley
- Maribel
- Andre

## Cómo se trabaja (traspaso en 2 pasos)

1. En el **almacén de origen**, una de las personas autorizadas crea el traspaso y lo
   valida (la mercancía "sale").
2. En el **almacén de destino**, una persona con el permiso **Recepcionar traspasos
   entre almacenes** valida la **recepción** cuando la mercancía llega.

## Qué verá cada usuario

- Si una persona **autorizada** crea un traspaso: funciona con normalidad.
- Si una persona sin ninguno de los dos permisos intenta crear o validar un
  traspaso: Odoo mostrará un aviso de que no tiene permiso.
- El permiso de recepción no habilita la creación de traspasos.

## Cómo dar o quitar el permiso a alguien

Si en el futuro queréis que otra persona pueda hacer traspasos (o dejar de hacerlos):

1. Entrad en **Ajustes → Usuarios y compañías → Usuarios**.
2. Abrid el usuario.
3. En el apartado **Permisos Especiales**, asignad según corresponda:
   - **Traspasos entre almacenes** para crear y validar traspasos.
   - **Recepcionar traspasos entre almacenes** para validar recepciones sin crear.
4. Guardad.

## Nota importante

Cualquier persona que deba hacer traspasos tiene que tener marcado ese permiso,
incluidos responsables o encargados. Si alguien autorizado no puede crear un traspaso,
revisad que tenga el grupo **Traspasos entre almacenes** asignado.

Cualquier duda, quedamos a vuestra disposición.
