/*
Copyright 2013-2015 ASIAL CORPORATION

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

*/

import util from '../util';
import platform from '../platform';

export class LazyRepeatDelegate {

  constructor(userDelegate, templateElement = null) {
    if (typeof userDelegate !== 'object' || userDelegate === null) {
      throw Error('"delegate" parameter must be an object.');
    }
    this._userDelegate = userDelegate;

    if (!(templateElement instanceof Element) && templateElement !== null) {
      throw Error('"templateElement" parameter must be an instance of Element or null.');
    }
    this._templateElement = templateElement;
  }

  /**
   * @return {Boolean}
   */
  hasRenderFunction() {
    return this._userDelegate._render instanceof Function;
  }

  /**
   * @return {void}
   */
  _render(items, height) {
    this._userDelegate._render(items, height);
  }

  /**
   * @param {Number} index
   * @param {Element} parent
   * @param {Function} done A function that take item object as parameter.
   */
  loadItemElement(index, done) {
    if (this._userDelegate.loadItemElement instanceof Function) {
      this._userDelegate.loadItemElement(index, done);
    } else {
      const element = this._userDelegate.createItemContent(index, this._templateElement);
      if (!(element instanceof Element)) {
        throw Error('createItemContent() must return an instance of Element.');
      }

      done({element});
    }
  }

  /**
   * @return {Number}
   */
  countItems() {
    const count = this._userDelegate.countItems();
    if (typeof count !== 'number') {
      throw Error('countItems() must return a number.');
    }
    return count;
  }

  /**
   * @param {Number} index
   * @param {Object} item
   * @param {Element} item.element
   */
  updateItem(index, item) {
    if (this._userDelegate.updateItemContent instanceof Function) {
      this._userDelegate.updateItemContent(index, item);
    }
  }

  /**
   * @param {Number} index
   * @param {Object} item
   */
  destroyItem(index, item) {
    if (this._userDelegate.destroyItem instanceof Function) {
      this._userDelegate.destroyItem(index, item);
    }
  }

  /**
   * @return {void}
   */
  destroy() {
    if (this._userDelegate.destroy instanceof Function) {
      this._userDelegate.destroy();
    }

    this._userDelegate = this._templateElement = null;
  }
}

/**
 * This class provide core functions for ons-lazy-repeat.
 */
export class LazyRepeatProvider {

  /**
   * @param {Element} wrapperElement
   * @param {LazyRepeatDelegate} delegate
   */
  constructor(wrapperElement, delegate) {
    if (!(delegate instanceof LazyRepeatDelegate)) {
      throw Error('"delegate" parameter must be an instance of LazyRepeatDelegate.');
    }

    this._wrapperElement = wrapperElement;
    this._delegate = delegate;
    if (!this._wrapperElement.children[0] || this._wrapperElement.children[0].tagName !== 'ONS-LAZY-REPEAT') {
      this._wrapperElement.insertBefore(document.createElement('span'), this._wrapperElement.children[0]);
    }
    this._paddingElement = wrapperElement.children[0];
    this._paddingElement.style.display = 'block';
    this._paddingElement.style.height = 0;

    if (wrapperElement.tagName.toLowerCase() === 'ons-list') {
      wrapperElement.classList.add('lazy-list');
    }

    this._pageContent = this._findPageContentElement(wrapperElement);

    if (!this._pageContent) {
      throw new Error('ons-lazy-repeat must be a descendant of an <ons-page> or an element.');
    }

    this.lastScrollTop = this._pageContent.scrollTop;

    this._topPositions = [0];
    this._renderedItems = {};
    this._renderQueue = [];

    this._addEventListeners();
    this.ready = this.setup();
  }

  get padding() {
    return parseInt(this._paddingElement.style.height, 10);
  }

  set padding(newValue) {
    this._paddingElement.style.height = newValue + 'px';
  }

  _findPageContentElement(wrapperElement) {
    const pageContent = util.findParent(wrapperElement, '.page__content');

    if (pageContent) {
      return pageContent;
    }

    const page = util.findParent(wrapperElement, 'ons-page');
    if (page) {
      const content = util.findChild(page, '.content');
      if (content) {
        return content;
      }
    }

    return null;
  }

  _countItems() {
    return this._delegate.countItems();
  }

  _getItemHeight(i) {
    return this._topPositions[i + 1] - this._topPositions[i];
  }

  _calculateRenderedHeight() {
    return Object.keys(this._renderedItems).reduce((a, b) => a + this._renderedItems[b].element.offsetHeight, 0)
  }

  _onChange() {
    if (!this._isRefreshing) {
      this._render();
    }
  }

  refresh(index) {
    if (index === undefined) {
      return this.refreshAll();
    }

    if (!this._renderedItems.hasOwnProperty(index) || this._renderedItems[index].isRefreshing === true) {
      return Promise.reject('Item is not rendered or is already refreshing');
    }

    this._renderedItems[index].isRefreshing = true;

    return new Promise(resolve => {
      this._delegate.loadItemElement(index, item => {
        this._wrapperElement.insertBefore(item.element, this._renderedItems[index].element);
        this._removeElement(index, true);
        setImmediate(() => {
          this._topPositions[index + 1] = this._topPositions[index] + item.element.offsetHeight;

          this._renderedItems[index] = item;
          resolve(item.element);
        });
      });
    });
  }

  refreshAll() {
    if (this._isRefreshing) {
      return Promise.reject('Already refreshing.');
    }

    if (this._countItems() === 0) {
      return Promise.resolve();
    }

    this._isRefreshing = true;
    const firstItemIndex = Math.min(...Object.keys(this._renderedItems));
    this._wrapperElement.style.height = this._topPositions[firstItemIndex] + this._calculateRenderedHeight() + 'px';

    this._removeAllElements();

    return new Promise(resolve => {
      this._render({
        forceScrollDown: true,
        forceStartIndex: firstItemIndex,
        scrollDownCallback: () => {
          this._wrapperElement.style.height = 'inherit';
          this._isRefreshing = false;
          resolve();
        }
      });
    });
  }

  setup() {
    if (this._isRefreshing === true) {
      return Promise.reject('Already refreshing.');
    }

    this._isRefreshing = true;
    this._removeAllElements();
    this.padding = 0;

    return new Promise(resolve => {
      this._render({
        forceScrollDown: true,
        scrollDownCallback: () => {
          this._isRefreshing = false;
          resolve();
        }
      });
    });
  }

  _render({forceScrollDown = false, forceStartIndex, scrollDownCallback = () => {}} = {}) {
    const offset = this._wrapperElement.getBoundingClientRect().top;
    const limit = 4 * window.innerHeight - offset;
    const count = this._countItems();

    const keep = {};
    const isScrollUp = !forceScrollDown && this.lastScrollTop > this._pageContent.scrollTop;
    this.lastScrollTop = this._pageContent.scrollTop;

    if (isScrollUp) {
      const firstIndex = Math.max(0, this._calculateStartIndex(offset) - 30);
      const lastIndex = Math.max(0, ...Object.keys(this._renderedItems));
      let i = firstIndex;

      for (i; i <= lastIndex && this._topPositions[i] < limit; i++) {/* empty */}
      for (--i; i >= firstIndex; i--) {
        this._renderElement(i);
        keep[i] = true;
      }

      Object.keys(this._renderedItems).forEach(key => {
        if (!keep[key]) {
          this._removeElement(+(key), isScrollUp);
          this._renderQueue.length = 0; // Make it dirty
        }
      });

    } else {

      const start = (forceStartIndex || Math.max(0, ...Object.keys(this._renderedItems)));

      this._runRenderQueue(id => this._asyncLoop(start, id, count, limit)
        .then(i => {
          let j = Math.max(0, this._calculateStartIndex(offset) - 30);
          for (j; j <= i; j++) {
            keep[j] = true;
          }

          Object.keys(this._renderedItems).forEach(key => keep[key] || this._removeElement(+(key), isScrollUp));

          scrollDownCallback();
        })
        .catch(() => scrollDownCallback())
      );
    }
  }

  _asyncLoop(i, id, count, limit) {
    if (i < count) {
      if (i >= this._topPositions.length) { // perf optimization
        this._topPositions.length += 100;
      }
      return this._renderElementAsync(i, id)
      .then(newTopPosition => newTopPosition > limit ? Promise.resolve(i) : this._asyncLoop(++i, id, count, limit));
    } else {
      return Promise.resolve(i);
    }
  }

  _runRenderQueue(newRender) { // FIFO
    if (newRender && this._renderQueue) {
      newRender._id = + new Date();
      this._renderQueue.push(newRender);
    }
    if (!newRender || this._renderQueue.length === 1) {
      const tmpId = this._renderQueue[0]._id;
      this._renderQueue[0](tmpId).then(() => {
        if (!this._renderQueue || this._renderQueue.length === 0 || this._renderQueue[0]._id !== tmpId) {
          return;
        }
        this._renderQueue.shift();
        if (this._renderQueue.length > 0) {
          this._runRenderQueue()
        }
      });
    }
  }

  /**
   * @param {Object} item
   * @param {Number} item.index
   * @param {Number} item.topPosition
   */
  _renderElement(index) {
    if (this._renderedItems.hasOwnProperty(index)) {
      this._delegate.updateItem(index, this._renderedItems[index]); // update if it exists
      return;
    }

    this._delegate.loadItemElement(index, item => {
      this._wrapperElement.insertBefore(item.element, this._wrapperElement.children[1])
      this.padding = this._topPositions[index];
      this._renderedItems[index] = item;
    });
  }


  /**
   * @param {Object} item
   * @param {Number} item.index
   * @param {Number} item.topPosition
   */
  _renderElementAsync(index, id) {
    if (this._renderedItems.hasOwnProperty(index)) {
      this._delegate.updateItem(index, this._renderedItems[index]); // update if it exists
      return Promise.resolve(this._topPositions[index + 1]);
    }

    return new Promise((resolve, reject) => {
      this._delegate.loadItemElement(index, item => {
        this._wrapperElement.appendChild(item.element);
        setImmediate(() => {
          if (!this._renderQueue || this._renderQueue.length === 0 || this._renderQueue[0]._id !== id) {
            this._delegate && this._delegate.destroyItem(index, item);
            item.element.remove();

            delete item.element;
            return reject();
          }
          this._topPositions[index + 1] = this._topPositions[index] + item.element.offsetHeight;

          this._renderedItems[index] = item;
          resolve(this._topPositions[index + 1]);
        });
      });
    });
  }

  /**
   * @param {Number} index
   */
  _removeElement(index, isScrollUp) {
    const item = this._renderedItems[index];
    const itemHeight = item.element.offsetHeight;
    if (!isScrollUp) {
      this.padding = this.padding + itemHeight;
      this._topPositions[index + 1] = this._topPositions[index] + itemHeight; // Update height to allow modifications
    }

    this._delegate.destroyItem(index, item);
    if (item.element.parentElement) {
      item.element.parentElement.removeChild(item.element);
    }

    delete this._renderedItems[index];
  }

  _removeAllElements() {
    Object.keys(this._renderedItems).forEach(key => this._removeElement(+(key), true));
  }

  _calculateStartIndex(current) {
    let start = 0;
    let end = this._countItems() - 1;

    // Binary search for index at top of screen so we can speed up rendering.
    for (;;) {
      const middle = Math.floor((start + end) / 2);
      const value = current + this._topPositions[middle];

      if (end < start) {
        return 0;
      } else if (value <= 0 && value + this._getItemHeight(middle) > 0) {
        return middle;
      } else if (isNaN(value) || value >= 0) {
        end = middle - 1;
      } else {
        start = middle + 1;
      }
    }
  }

  _debounce(func, wait, immediate) {
    let timeout;
    return function() {
      const callNow = immediate && !timeout;
      clearTimeout(timeout);
      if (callNow) {
        func.apply(this, arguments);
      } else {
        timeout = setTimeout(() => {
          timeout = null;
          func.apply(this, arguments);
        }, wait);
      }
    };
  }

  _doubleFireOnTouchend() {
    this._render();
    this._debounce(this._render.bind(this), 100);
  }

  _addEventListeners() {
    util.bindListeners(this, ['_onChange', '_doubleFireOnTouchend']);

    if (platform.isIOS()) {
      this._boundOnChange = this._debounce(this._boundOnChange, 30);
    }

    this._pageContent.addEventListener('scroll', this._boundOnChange, true);

    if (platform.isIOS()) {
      this._pageContent.addEventListener('touchmove', this._boundOnChange, true);
      this._pageContent.addEventListener('touchend', this._boundDoubleFireOnTouchend, true);
    }

    window.document.addEventListener('resize', this._boundOnChange, true);
  }

  _removeEventListeners() {
    this._pageContent.removeEventListener('scroll', this._boundOnChange, true);

    if (platform.isIOS()) {
      this._pageContent.removeEventListener('touchmove', this._boundOnChange, true);
      this._pageContent.removeEventListener('touchend', this._boundDoubleFireOnTouchend, true);
    }

    window.document.removeEventListener('resize', this._boundOnChange, true);
  }

  destroy() {
    this._removeAllElements();
    this._delegate.destroy();
    this._parentElement = this._delegate = this._renderQueue = this._renderedItems = null;
    this._removeEventListeners();
  }
}

