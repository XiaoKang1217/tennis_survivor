"""Parse the source's singles RR statistics and explicit knockout columns."""
from html.parser import HTMLParser
import json
import re
import sys


class Node:
    def __init__(self, tag='', attrs=()):
        self.tag, self.attrs, self.children = tag, dict(attrs), []

    def has(self, name):
        return name in self.attrs.get('class', '').split()

    def find(self, predicate):
        return [n for c in self.children if isinstance(c, Node)
                for n in ([c] if predicate(c) else []) + c.find(predicate)]

    def text(self):
        return ' '.join(c.text() if isinstance(c, Node) else c for c in self.children)


class Tree(HTMLParser):
    def __init__(self, html):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]
        self.feed(html)

    def handle_starttag(self, tag, attrs):
        n = Node(tag, attrs)
        self.stack[-1].children.append(n)
        if tag not in {'img', 'br', 'hr', 'input', 'meta', 'link', 'source', 'wbr', 'area'}:
            self.stack.append(n)

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, data):
        self.stack[-1].children.append(data)


def parse(html):
    root = Tree(html).root
    parts = root.find(lambda n: n.has('cDrawPart') and n.attrs.get('data-id') == 'WS')
    players = {}
    groups = []
    for part in parts:
        for table in part.find(lambda n: n.has('cDrawBlockRR')):
            # Only outer rows: nested Match/Set/Game tables are not player rows.
            body = next((n for n in table.children if isinstance(n, Node) and n.tag == 'tbody'), table)
            rows = [n for n in body.children if isinstance(n, Node) and n.tag == 'tr']
            ids = []
            for row in rows[1:]:
                cells = [n for n in row.children if isinstance(n, Node) and n.tag == 'td']
                if not cells:
                    continue
                names = cells[0].find(lambda n: n.tag == 'pname')
                # The source may insert an empty spacer row after the group header.
                if not names and not row.text().strip() and not row.find(lambda n: n.tag == 'pname'):
                    continue
                if len(names) != 1:
                    raise ValueError('Ambiguous singles player row')
                name = names[0]
                pid = name.attrs['data-id']
                stats = cells[0].find(lambda n: n.has('cDrawBlockRRSubTable'))
                match = re.search(r'Match\s+(\d+)\s*-\s*(\d+)', stats[0].text()) if stats else None
                if stats and not match:
                    raise ValueError('Unrecognized RR statistics')
                wins, losses = map(int, match.groups()) if match else (0, 0)
                if wins + losses > 3 or pid in players:
                    raise ValueError('Invalid or duplicate RR record')
                players[pid] = dict(source_id=pid, name=name.attrs.get('alt'), rr_wins=wins,
                                    rr_losses=losses, stage='RR', eliminated=cells[0].has('text-delete'))
                ids.append(pid)
            if len(ids) < 4:
                raise ValueError('Incomplete RR group')
            if sum(players[p]['rr_wins'] for p in ids) != sum(players[p]['rr_losses'] for p in ids):
                raise ValueError('Inconsistent RR win/loss totals')
            groups.append(ids)
    if len(groups) != 2:
        raise ValueError('Expected two singles groups')
    for part in parts:
        if part.find(lambda n: n.has('cDrawBlockRR')):
            continue
        for table in part.find(lambda n: n.has('cDrawBlock')):
            for row in table.find(lambda n: n.tag == 'tr'):
                cells = [n for n in row.children if isinstance(n, Node) and n.tag == 'td']
                if not cells or not cells[0].has('cDrawSeq'):
                    continue
                for index, cell in enumerate(cells[1:4]):
                    for name in cell.find(lambda n: n.tag == 'pname'):
                        pid = name.attrs.get('data-id')
                        if pid not in players:
                            raise ValueError('Unknown knockout participant')
                        stage = ['SF', 'F', 'W'][index]
                        if ['RR', 'SF', 'F', 'W'].index(stage) > ['RR', 'SF', 'F', 'W'].index(players[pid]['stage']):
                            players[pid]['stage'] = stage
    stages = [p['stage'] for p in players.values()]
    if sum(s != 'RR' for s in stages) > 4 or sum(s in ('F', 'W') for s in stages) > 2 or stages.count('W') > 1:
        raise ValueError('Invalid knockout participant counts')
    for ids in groups:
        qualified = sum(players[p]['stage'] != 'RR' for p in ids)
        for pid in ids:
            p = players[pid]
            # Do not infer advancement or elimination from a single RR result.
            p['eliminated'] |= (qualified == 2 and p['stage'] == 'RR')
            p['eliminated'] |= p['stage'] == 'SF' and sum(s in ('F', 'W') for s in stages) == 2
            p['eliminated'] |= p['stage'] == 'F' and 'W' in stages
    return list(players.values())


if __name__ == '__main__':
    print(json.dumps(parse(sys.stdin.read()), ensure_ascii=False))
