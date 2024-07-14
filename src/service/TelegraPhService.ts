interface TelegraPhService {
    createAccount: (short_name: string, author_name: string, author_url?: string) => Promise<any>;
    createPage: (access_token: string, title: string, author_name: string, author_url: string, content: any, return_content: boolean) => Promise<any>;
}

export class TelegraPhServiceImpl implements TelegraPhService {
    async createAccount(short_name: string, author_name: string, author_url?: string): Promise<any> {

    }

    async createPage(access_token: string, title: string, author_name: string, author_url: string, content: any, return_content: boolean): Promise<any> {

    }
}


// function domToNode(domNode) {
//     if (domNode.nodeType == domNode.TEXT_NODE) {
//         return domNode.data
//     }
//     if (domNode.nodeType != domNode.ELEMENT_NODE) {
//         return false
//     }
//     const nodeElement = {}
//     nodeElement.tag = domNode.tagName.toLowerCase()
//     for (var i = 0; i < domNode.attributes.length; i++) {
//         const attr = domNode.attributes[i]
//         if (attr.name == 'href' || attr.name == 'src') {
//             if (!nodeElement.attrs) {
//                 nodeElement.attrs = {}
//             }
//             nodeElement.attrs[attr.name] = attr.value
//         }
//     }
//     if (domNode.childNodes.length > 0) {
//         nodeElement.children = []
//         for (var i = 0; i < domNode.childNodes.length; i++) {
//             const child = domNode.childNodes[i]
//             nodeElement.children.push(domToNode(child))
//         }
//     }
//     return nodeElement
// }
//
// function nodeToDom(node) {
//     if (typeof node === 'string' || node instanceof String) {
//         return document.createTextNode(node)
//     }
//     if (node.tag) {
//         var domNode = document.createElement(node.tag)
//         if (node.attrs) {
//             for (const name in node.attrs) {
//                 const value = node.attrs[name]
//                 domNode.setAttribute(name, value)
//             }
//         }
//     } else {
//         var domNode = document.createDocumentFragment()
//     }
//     if (node.children) {
//         for (let i = 0; i < node.children.length; i++) {
//             const child = node.children[i]
//             domNode.appendChild(nodeToDom(child))
//         }
//     }
//     return domNode
// }
//
// const article = document.getElementById('article')
// const content = domToNode(article).children
// $.ajax('https://api.telegra.ph/createPage', {
//     data: {
//         access_token:   '%access_token%',
//         title:          'Title of page',
//         content:        JSON.stringify(content),
//         return_content: true
//     },
//     type: 'POST',
//     dataType: 'json',
//     success: function(data) {
//         if (data.content) {
//             while (article.firstChild) {
//                 article.removeChild(article.firstChild)
//             }
//             article.appendChild(nodeToDom({children: data.content}))
//         }
//     }
// })