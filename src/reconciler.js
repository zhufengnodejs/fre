import { createElement, updateElement } from './element'
import { resetCursor } from './hooks'
import { defer, arrayfy } from './util'

const [HOST, HOOK, ROOT, PLACE, DELETE, UPDATE] = ['host','hook','root','place','delete','update']

let updateQueue = []
let nextWork = null
let pendingCommit = null
let currentInstance = null

export function render (vdom, container) {
  updateQueue.push({
    from: ROOT,
    base: container,
    props: { children: vdom }
  })
  defer(workLoop)
}

export function scheduleWork (instance) {
  updateQueue.push({
    from: HOOK,
    instance,
    state: instance.state
  })
  defer(workLoop)
}

function workLoop () {
  if (!nextWork && updateQueue.length) {
    resetWork()
  }
  while (nextWork) {
    nextWork = performWork(nextWork)
  }
  if (pendingCommit) {
    commitAllWork(pendingCommit)
  }
}

function resetWork () {
  const update = updateQueue.shift()
  if (!update) return

  if (update.state) {
    update.instance.fiber.state = update.state
  }
  const root =
    update.from == ROOT ? update.base.rootFiber : getRoot(update.instance.fiber)

  nextWork = {
    tag: ROOT,
    base: update.base || root.base,
    props: update.props || root.props,
    alternate: root
  }
}

function performWork (WIP) {
  WIP.tag == HOOK ? updateHOOK(WIP) : updateHost(WIP)

  if (WIP.child) {
    return WIP.child
  }
  let wip = WIP
  while (wip) {
    completeWork(wip)
    if (wip.sibling) return wip.sibling
    wip = wip.parent
  }
}

function updateHost (WIP) {
  if (!WIP.base) WIP.base = createElement(WIP)

  const newChildren = WIP.props.children
  reconcileChildren(WIP, newChildren)
}

function updateHOOK (WIP) {
  let instance = WIP.base
  if (instance == null) {
    instance = WIP.base = createInstance(WIP)
  } else if (WIP.props == WIP.props && !WIP.state) {
    cloneChildFibers(WIP)
  }
  instance.props = WIP.props || {}
  instance.state = WIP.state || {}
  instance.effects = WIP.effects || {}
  currentInstance = instance
  resetCursor()
  const newChildren = WIP.type(WIP.props)
  reconcileChildren(WIP, newChildren)
}

function reconcileChildren (WIP, newChildren) {
  const childs = arrayfy(newChildren)
  let keyed = {}
  let index = 0
  let oldFiber = WIP.alternate ? WIP.alternate.child : null
  let newFiber = null

  while (index < childs.length || oldFiber != null) {
    const prevFiber = newFiber
    const child = index < childs.length && childs[index]
    if (child.props && child.props.key) keyed[child.props.key] = child

    const sameType = oldFiber && child && child.type == oldFiber.type
    if (sameType) { 
      if (keyed[oldFiber.props.key]) {
        // 有 key 的情况
        newFiber = {
          tag: oldFiber.tag,
          base: oldFiber.base,
          parent: WIP,
          alternate: oldFiber,
          patchTag: null, // 直接重复利用
          type: oldFiber.type,
          props: child.props || { nodeValue: child.nodeValue },
          state: oldFiber.state
        }
        delete keyed[oldFiber.props.key]
      } else { //没有 key，插入
        newFiber = {
          tag: oldFiber.tag,
          base: oldFiber.base,
          parent: WIP,
          alternate: oldFiber,
          patchTag: UPDATE,
          type: oldFiber.type,
          props: child.props || { nodeValue: child.nodeValue },
          state: oldFiber.state
        }
      }
    }

    if (child && !sameType) {
      newFiber = {
        tag: typeof child.type === 'string' ? HOST : HOOK,
        type: child.type,
        props: child.props || { nodeValue: child.nodeValue },
        parent: WIP,
        patchTag: PLACE
      }
    }

    if (oldFiber && !sameType) {
      oldFiber.patchTag = DELETE
      WIP.patches = WIP.patches || []
      WIP.patches.push(oldFiber)
    }

    if (oldFiber) {
      oldFiber = oldFiber.sibling
    }

    if (index == 0) {
      WIP.child = newFiber
    } else if (prevFiber && child) {
      prevFiber.sibling = newFiber
    }

    index++
  }
}

function createInstance (fiber) {
  const instance = new fiber.type(fiber.props)
  instance.fiber = fiber
  return instance
}

function cloneChildFibers (parentFiber) {
  const oldFiber = parentFiber.alternate
  if (!oldFiber.child) return

  let oldChild = oldFiber.child
  let prevChild = null

  while (oldChild) {
    const newChild = {
      type: oldChild.type,
      tag: oldChild.tag,
      base: oldChild.base,
      props: oldChild.props,
      state: oldChild.state,
      alternate: oldChild,
      parent: parentFiber
    }
    if (prevChild) {
      prevChild.sibling = newChild
    } else {
      parentFiber.child = newChild
    }
    prevChild = newChild
    oldChild = oldChild.sibling
  }
}

function completeWork (fiber) {
  if (fiber.tag == HOOK) {
    fiber.base.fiber = fiber
  }

  if (fiber.parent) {
    const childPatches = fiber.patches || []
    const selfPatch = fiber.patchTag ? [fiber] : []
    const parentPatches = fiber.parent.patches || []
    fiber.parent.patches = parentPatches.concat(childPatches, selfPatch)
  } else {
    pendingCommit = fiber
  }
}

function commitAllWork (WIP) {
  WIP.patches.forEach(f => commitWork(f))
  commitEffects(currentInstance.effects)
  WIP.base.rootFiber = WIP

  nextWork = null
  pendingCommit = null
}

function commitWork (fiber) {
  if (fiber.tag == ROOT) return

  let parentFiber = fiber.parent
  while (parentFiber.tag == HOOK) {
    parentFiber = parentFiber.parent
  }
  const parentNode = parentFiber.base

  if (fiber.patchTag == PLACE && fiber.tag == HOST) {
    parentNode.appendChild(fiber.base)
  } else if (fiber.patchTag == UPDATE && fiber.tag == HOST) {
    updateElement(fiber.base, fiber.alternate.props, fiber.props)
  } else if (fiber.patchTag == DELETE) {
    commitDELETE(fiber, parentNode)
  }
}

function commitDELETE (fiber, domParent) {
  let node = fiber
  while (true) {
    if (node.tag == HOOK) {
      node = node.child
      continue
    }
    domParent.removeChild(node.base)
    while (node != fiber && !node.sibling) {
      node = node.parent
    }
    if (node == fiber) {
      return
    }
    node = node.sibling
  }
}

function getRoot (fiber) {
  let node = fiber
  while (node.parent) {
    node = node.parent
  }
  return node
}

export function getCurrentInstance () {
  return currentInstance || null
}

function commitEffects (effects) {
  Object.keys(effects).forEach(key => {
    let effect = effects[key]
    effect()
  })
}
