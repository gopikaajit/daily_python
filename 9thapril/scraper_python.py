# print("Hello world!")
# scraper-python.py
# To run this script, paste `python scraper-python.py` in the terminal

import requests
from bs4 import BeautifulSoup


# def scrape():
    
#     url = 'https://www.example.com'
#     response = requests.get(url)
#     print("\n\n\nresponse is")
#     print(response.text)
#     soup = BeautifulSoup(response.text, 'html.parser')
#     print("\n\n\nsoup is")
#     print(soup)



# if __name__ == '__main__':
#     print("Hello world!")
#     scrape()


#####################################
#TO SCRAPE HYPERLINKS ONLY

# Fetch the content of a web page
response = requests.get('https://example.com')
soup = BeautifulSoup(response.text, 'html.parser')

# Find all links on the page
print(soup.find_all('p'))
for link in soup.find_all('a'):
    print("type of link is")
    print(type(link))
    print(link.get('href'))


page_title = soup.title.string

# Print the title
print(page_title)