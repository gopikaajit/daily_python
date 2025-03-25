#readingfile
print("A program to read a file, write hello world in it and read the same file to print its contents")
f= open("helloworld.txt","a")
f.write("Hello world!!")
f.close()

f= open("helloworld.txt","r")
print(f.read())
